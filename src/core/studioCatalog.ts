/**
 * src/core/studioCatalog.ts — Unified UI Catalog for VS Code Extension & Desktop Application
 */

export interface LanguageCatalogItem {
  id: string;
  label: string;
  group: 'POPULAR' | 'JVM' | 'SYSTEMS' | 'DATA & SCIENCE' | 'WEB & MOBILE' | 'INFRA & CONFIG';
  ext: string;
  vsLang: string;
}

export const ALL_SUPPORTED_LANGUAGES: LanguageCatalogItem[] = [
  // POPULAR
  { id: 'python', label: 'Python', group: 'POPULAR', ext: '.py', vsLang: 'python' },
  { id: 'typescript', label: 'TypeScript', group: 'POPULAR', ext: '.ts', vsLang: 'typescript' },
  { id: 'javascript', label: 'JavaScript', group: 'POPULAR', ext: '.js', vsLang: 'javascript' },

  // JVM
  { id: 'java', label: 'Java', group: 'JVM', ext: '.java', vsLang: 'java' },
  { id: 'csharp', label: 'C#', group: 'JVM', ext: '.cs', vsLang: 'csharp' },
  { id: 'kotlin', label: 'Kotlin', group: 'JVM', ext: '.kt', vsLang: 'kotlin' },
  { id: 'scala', label: 'Scala', group: 'JVM', ext: '.scala', vsLang: 'scala' },

  // SYSTEMS
  { id: 'go', label: 'Go', group: 'SYSTEMS', ext: '.go', vsLang: 'go' },
  { id: 'rust', label: 'Rust', group: 'SYSTEMS', ext: '.rs', vsLang: 'rust' },
  { id: 'cpp', label: 'C++', group: 'SYSTEMS', ext: '.cpp', vsLang: 'cpp' },
  { id: 'c', label: 'C', group: 'SYSTEMS', ext: '.c', vsLang: 'c' },
  { id: 'swift', label: 'Swift', group: 'SYSTEMS', ext: '.swift', vsLang: 'swift' },

  // DATA & SCIENCE
  { id: 'sql', label: 'Modern SQL', group: 'DATA & SCIENCE', ext: '.sql', vsLang: 'sql' },
  { id: 'pyspark', label: 'PySpark', group: 'DATA & SCIENCE', ext: '.py', vsLang: 'python' },
  { id: 'r', label: 'R', group: 'DATA & SCIENCE', ext: '.r', vsLang: 'r' },
  { id: 'julia', label: 'Julia', group: 'DATA & SCIENCE', ext: '.jl', vsLang: 'julia' },

  // WEB & MOBILE
  { id: 'php', label: 'PHP', group: 'WEB & MOBILE', ext: '.php', vsLang: 'php' },
  { id: 'ruby', label: 'Ruby', group: 'WEB & MOBILE', ext: '.rb', vsLang: 'ruby' },
  { id: 'dart', label: 'Dart', group: 'WEB & MOBILE', ext: '.dart', vsLang: 'dart' },

  // INFRA & CONFIG
  { id: 'bash', label: 'Bash Shell', group: 'INFRA & CONFIG', ext: '.sh', vsLang: 'shellscript' },
  { id: 'powershell', label: 'PowerShell', group: 'INFRA & CONFIG', ext: '.ps1', vsLang: 'powershell' },
  { id: 'terraform', label: 'Terraform', group: 'INFRA & CONFIG', ext: '.tf', vsLang: 'terraform' },
  { id: 'dockerfile', label: 'Dockerfile', group: 'INFRA & CONFIG', ext: '', vsLang: 'dockerfile' }
];

export interface DeliverableOption {
  id: string;
  label: string;
  icon: string;
  description: string;
}

export const DATA_DELIVERABLES: DeliverableOption[] = [
  { id: 'chat', label: 'Insights in chat', icon: '💬', description: 'Interactive statistical and anomaly insights streamed directly into your session.' },
  { id: 'report', label: 'HTML report', icon: '📈', description: 'Standalone offline HTML visual dashboard with interactive charts and KPI metric tiles.' },
  { id: 'notebook', label: 'Notebook / script', icon: '📓', description: 'Runnable Python / PySpark Jupyter notebook (.ipynb) with full exploratory data analysis.' },
  { id: 'profile', label: 'Profiling summary', icon: '📋', description: 'Data dictionary, null count statistics, schema quality gates, and drift checks.' }
];

export const REPORT_ARCHETYPES = [
  { id: 'executive', label: 'Executive Summary', description: 'High-level KPIs, headline trends, and strategic takeaways for leadership.' },
  { id: 'deepdive', label: 'Deep Dive & Diagnostics', description: 'Granular multi-dimensional breakdown, statistical distributions, and correlation matrices.' },
  { id: 'kpis', label: 'KPI & Metric Scorecard', description: 'Target vs actual progress, period-over-period delta badges, and health indicators.' },
  { id: 'quality', label: 'Data Quality & Schema Audit', description: 'Schema drift tests, null audits, duplicate checks, and Great Expectations assertions.' }
];
