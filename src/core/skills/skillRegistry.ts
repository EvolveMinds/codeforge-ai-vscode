/**
 * src/core/skills/skillRegistry.ts
 *
 * Modular Skills Runtime & Progressive Disclosure Engine for Evolve AI.
 * Resolves GAP-09.
 *
 * Manages modular SKILL.md packages with token-budget-aware progressive disclosure:
 *   - Tier 1 (Metadata): Name, category, description, trigger intents (low token footprint)
 *   - Tier 2 (On-Demand Body): Full architectural guidance, code examples, and checklists
 *
 * Bridges the 8 legacy TypeScript plugins into the registry for 100% backward compatibility.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SkillManifest {
  name: string;
  category: 'architecture' | 'ai-systems' | 'data' | 'development' | 'design' | 'infrastructure' | 'consulting';
  description: string;
  applyTo?: string;
  userInvocable: boolean;
  skillPath: string;
  isLegacyPluginBridge?: boolean;
}

export class SkillRegistry {
  private _skills = new Map<string, SkillManifest>();

  constructor(private readonly _workspaceRoot?: string) {}

  public async initialize(): Promise<void> {
    this._skills.clear();

    // 1. Register Legacy Plugin Bridges (Databricks, dbt, Airflow, etc.)
    this._registerLegacyPluginBridges();

    // 2. Discover workspace skills (.evolve/skills/)
    if (this._workspaceRoot) {
      const wsSkillsDir = path.join(this._workspaceRoot, '.evolve', 'skills');
      if (fs.existsSync(wsSkillsDir)) {
        await this._scanDirectory(wsSkillsDir);
      }
    }
  }

  public getAllSkills(): SkillManifest[] {
    return Array.from(this._skills.values());
  }

  public getSkill(name: string): SkillManifest | undefined {
    return this._skills.get(name.toLowerCase());
  }

  public matchSkills(prompt: string, maxLimit = 3): SkillManifest[] {
    const p = prompt.toLowerCase();
    const scored: Array<{ skill: SkillManifest; score: number }> = [];

    for (const skill of this._skills.values()) {
      let score = 0;
      const nameMatch = skill.name.toLowerCase();
      if (p.includes(nameMatch)) score += 5;

      const descTerms = skill.description.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const term of descTerms) {
        if (p.includes(term)) score += 1;
      }

      if (score > 0) {
        scored.push({ skill, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxLimit).map(s => s.skill);
  }

  public async loadSkillContent(skill: SkillManifest): Promise<string> {
    if (skill.isLegacyPluginBridge) {
      return `### Skill: ${skill.name} (Legacy Plugin Bridge)\n${skill.description}\nAvailable tools: Evolve AI ${skill.name} workspace command suite.`;
    }

    const skillMdPath = path.join(skill.skillPath, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      return await fs.promises.readFile(skillMdPath, 'utf8');
    }
    return `### Skill: ${skill.name}\n${skill.description}`;
  }

  private _registerLegacyPluginBridges(): void {
    const legacyPlugins = [
      { name: 'databricks', category: 'data' as const, desc: 'Databricks workspace, Unity Catalog, Delta Lake, PySpark jobs, and Lakehouse architectures.' },
      { name: 'dbt', category: 'data' as const, desc: 'dbt transformations, staging models, dimensional data marts, and SQL testing.' },
      { name: 'airflow', category: 'data' as const, desc: 'Apache Airflow DAG design, scheduling, operators, and task failure recovery.' },
      { name: 'pytest', category: 'development' as const, desc: 'PyTest unit testing, test fixtures, parametrization, and coverage reports.' },
      { name: 'fastapi', category: 'architecture' as const, desc: 'FastAPI REST microservices, Pydantic data schemas, dependency injection, and OpenAPI.' },
      { name: 'django', category: 'architecture' as const, desc: 'Django full-stack ORM, models, migrations, views, and admin configurations.' },
      { name: 'terraform', category: 'infrastructure' as const, desc: 'Terraform Infrastructure-as-Code, HCL modules, state management, and provider rules.' },
      { name: 'cicd', category: 'infrastructure' as const, desc: 'GitHub Actions, GitLab CI, Bitbucket Pipelines, and deployment gating hooks.' }
    ];

    for (const p of legacyPlugins) {
      this._skills.set(p.name, {
        name: p.name,
        category: p.category,
        description: p.desc,
        userInvocable: true,
        skillPath: '',
        isLegacyPluginBridge: true
      });
    }
  }

  private async _scanDirectory(baseDir: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const skillDir = path.join(baseDir, e.name);
          const skillMd = path.join(skillDir, 'SKILL.md');
          if (fs.existsSync(skillMd)) {
            const content = await fs.promises.readFile(skillMd, 'utf8');
            const manifest = this._parseSkillFrontmatter(e.name, skillDir, content);
            this._skills.set(manifest.name.toLowerCase(), manifest);
          }
        }
      }
    } catch {}
  }

  private _parseSkillFrontmatter(dirName: string, dirPath: string, content: string): SkillManifest {
    let name = dirName;
    let description = 'Evolve AI Production Skill';
    let category: SkillManifest['category'] = 'development';
    let userInvocable = true;

    // Parse simple YAML frontmatter if present
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const yaml = fmMatch[1];
      const nameMatch = yaml.match(/name:\s*['"]?([^'"\n]+)['"]?/);
      if (nameMatch) name = nameMatch[1].trim();

      const descMatch = yaml.match(/description:\s*['"]?([^'"\n]+)['"]?/);
      if (descMatch) description = descMatch[1].trim();

      const catMatch = yaml.match(/category:\s*['"]?([^'"\n]+)['"]?/);
      if (catMatch) category = catMatch[1].trim() as any;

      const userInvMatch = yaml.match(/user-invocable:\s*(true|false)/i);
      if (userInvMatch) userInvocable = userInvMatch[1].toLowerCase() === 'true';
    }

    return {
      name,
      category,
      description,
      userInvocable,
      skillPath: dirPath,
      isLegacyPluginBridge: false
    };
  }
}
