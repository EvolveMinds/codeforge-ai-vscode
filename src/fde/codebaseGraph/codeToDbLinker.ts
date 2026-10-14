/**
 * fde/codebaseGraph/codeToDbLinker.ts — Cross-Layer Code-to-Database Schema Linker
 *
 * Bridges the gap between static code and live database schemas:
 *  - Matches introspected database tables to codebase SQL queries, ORM entities, and repositories
 *  - Detects data access patterns across Prisma, TypeORM, SQLAlchemy, Hibernate, and raw SQL
 *  - Generates cross-layer data links for the unified 3D/2D Data Cosmos
 */

import * as fs from 'fs';
import { ScannedFile } from './dependencyGrapher';
import { DbCodeLineage, CodeLink } from './types';

export interface CodeToDbLinkResult {
  lineages: DbCodeLineage[];
  links: CodeLink[];
  fileToTablesMap: Map<string, Set<string>>;
  tableToFilesMap: Map<string, Set<string>>;
}

export class CodeToDbLinker {
  /**
   * Primary entry point: Links database tables to scanned codebase files.
   */
  public static link(
    scannedFiles: ScannedFile[],
    knownTables: string[]
  ): CodeToDbLinkResult {
    const fileToTablesMap = new Map<string, Set<string>>();
    const tableToFilesMap = new Map<string, Set<string>>();
    const tableMatchTypes = new Map<string, Set<'sql-query' | 'orm-model' | 'migration' | 'repository'>>();

    // Standardize tables to lowercase lookup set
    const tableLookup = new Map<string, string>(); // lowercase -> original case
    for (const t of knownTables) {
      if (t && t.trim().length > 1) {
        tableLookup.set(t.trim().toLowerCase(), t.trim());
        tableToFilesMap.set(t.trim(), new Set());
      }
    }

    // If no explicit tables provided, auto-discover tables from CREATE TABLE statements
    if (tableLookup.size === 0) {
      const createTableRegex = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z0-9_]+)["`]?/gi;
      for (const file of scannedFiles) {
        if (file.language === 'sql' || file.relativePath.toLowerCase().endsWith('.sql')) {
          try {
            const content = fs.readFileSync(file.absolutePath, 'utf8');
            let m: RegExpExecArray | null;
            while ((m = createTableRegex.exec(content)) !== null) {
              const tbl = m[1]?.trim();
              if (tbl && tbl.length > 2 && !['if', 'not', 'exists', 'temp', 'temporary'].includes(tbl.toLowerCase())) {
                tableLookup.set(tbl.toLowerCase(), tbl);
                tableToFilesMap.set(tbl, new Set());
              }
            }
          } catch {}
        }
      }
    }

    if (tableLookup.size === 0) {
      return {
        lineages: [],
        links: [],
        fileToTablesMap: new Map(),
        tableToFilesMap: new Map()
      };
    }

    // Build regex matcher for known tables
    const tableNamesPattern = Array.from(tableLookup.keys())
      .map(t => this.escapeRegex(t))
      .join('|');

    if (!tableNamesPattern) {
      return {
        lineages: [],
        links: [],
        fileToTablesMap,
        tableToFilesMap
      };
    }

    const sqlQueryRegex = new RegExp(
      `\\b(FROM|JOIN|INTO|UPDATE|TABLE)\\s+["\`]?(${tableNamesPattern})["\`]?\\b`,
      'gi'
    );
    const ormModelRegex = new RegExp(
      `(@Entity\\s*\\(\\s*['"]?(${tableNamesPattern})['"]?\\s*\\)|__tablename__\\s*=\\s*['"](${tableNamesPattern})['"]|model\\s+(${tableNamesPattern})\\s*\\{)`,
      'gi'
    );

    for (const file of scannedFiles) {
      let content = '';
      try {
        content = fs.readFileSync(file.absolutePath, 'utf8');
      } catch {
        continue;
      }

      const foundInFile = new Set<string>();

      // 1. Direct SQL Matches
      let match: RegExpExecArray | null;
      sqlQueryRegex.lastIndex = 0;
      while ((match = sqlQueryRegex.exec(content)) !== null) {
        const matchedTbl = match[2]?.toLowerCase();
        if (matchedTbl && tableLookup.has(matchedTbl)) {
          const originalName = tableLookup.get(matchedTbl)!;
          foundInFile.add(originalName);
          this.recordMatchType(tableMatchTypes, originalName, 'sql-query');
        }
      }

      // 2. ORM Model Matches
      ormModelRegex.lastIndex = 0;
      while ((match = ormModelRegex.exec(content)) !== null) {
        const matchedTbl = (match[2] || match[3] || match[4])?.toLowerCase();
        if (matchedTbl && tableLookup.has(matchedTbl)) {
          const originalName = tableLookup.get(matchedTbl)!;
          foundInFile.add(originalName);
          this.recordMatchType(tableMatchTypes, originalName, 'orm-model');
        }
      }

      // 3. File path naming convention (e.g. "usersRepository.ts" -> "users")
      const baseLower = file.relativePath.toLowerCase();
      for (const [tLower, originalName] of tableLookup.entries()) {
        if (baseLower.includes(tLower) && (baseLower.includes('repo') || baseLower.includes('service') || baseLower.includes('model'))) {
          foundInFile.add(originalName);
          this.recordMatchType(tableMatchTypes, originalName, 'repository');
        }
      }

      if (foundInFile.size > 0) {
        fileToTablesMap.set(file.relativePath, foundInFile);
        for (const tbl of foundInFile) {
          tableToFilesMap.get(tbl)?.add(file.relativePath);
        }
      }
    }

    // Build Lineages & Links
    const lineages: DbCodeLineage[] = [];
    const links: CodeLink[] = [];

    for (const [tbl, filesSet] of tableToFilesMap.entries()) {
      if (filesSet.size > 0) {
        const files = Array.from(filesSet);
        const defaultTypes: Array<'sql-query' | 'orm-model' | 'migration' | 'repository'> = ['sql-query'];
        const matchTypes = Array.from(tableMatchTypes.get(tbl) || defaultTypes);

        lineages.push({
          tableName: tbl,
          files,
          matchTypes
        });

        for (const f of files) {
          links.push({
            source: f,
            target: `db:${tbl}`,
            type: 'data-access',
            weight: 1.0,
            label: `queries [${tbl}]`
          });
        }
      }
    }

    return {
      lineages,
      links,
      fileToTablesMap,
      tableToFilesMap
    };
  }

  private static recordMatchType(
    matchTypesMap: Map<string, Set<'sql-query' | 'orm-model' | 'migration' | 'repository'>>,
    tableName: string,
    type: 'sql-query' | 'orm-model' | 'migration' | 'repository'
  ): void {
    if (!matchTypesMap.has(tableName)) {
      matchTypesMap.set(tableName, new Set());
    }
    matchTypesMap.get(tableName)!.add(type);
  }

  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
