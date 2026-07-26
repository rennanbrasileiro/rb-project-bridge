'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJson, readJson } = require('../core/fs-utils.cjs');

function markdownEscape(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

class ReportService {
  constructor({ userDataDir, logger }) {
    this.userDataDir = userDataDir;
    this.logger = logger;
    this.historyPath = path.join(userDataDir, 'migration-history.json');
  }

  async writeReport(directory, report) {
    const jsonPath = path.join(directory, 'RB-BRIDGE-REPORT.json');
    const markdownPath = path.join(directory, 'RB-BRIDGE-REPORT.md');
    await writeJson(jsonPath, report);
    const findings = report.security?.findings ?? [];
    const markdown = `# RB Project Bridge — Migration Report

- **Status:** ${markdownEscape(report.status)}
- **Generated:** ${markdownEscape(report.finishedAt || report.startedAt)}
- **Base44 project:** ${markdownEscape(report.project?.name)}
- **Base44 app ID:** ${markdownEscape(report.project?.id)}
- **GitHub repository:** ${markdownEscape(report.github?.fullName || 'Not published')}
- **Commit:** ${markdownEscape(report.github?.sha || 'Not created')}
- **Build validation:** ${markdownEscape(report.build?.status || 'Not executed')}

## Scope

This migration exports source code and Base44 resource definitions. Database records, user accounts, stored secrets, OAuth grants, and uploaded files require separate migration and validation.

## Security

- Scanned files: ${report.security?.scannedFiles ?? 0}
- Findings: ${findings.length}
- Blocking findings: ${report.security?.blocking?.length ?? 0}
- Removed paths: ${report.sanitization?.removed?.length ?? 0}

${findings.length ? `| Severity | Rule | File | Line |\n|---|---|---|---:|\n${findings.map((item) => `| ${item.severity} | ${item.rule} | ${markdownEscape(item.file)} | ${item.line} |`).join('\n')}` : 'No secret findings were recorded.'}

## Base44 dependency inventory

- SDK references: ${report.base44Analysis?.sdkImports ?? 0}
- Entity definitions: ${report.base44Analysis?.entityFiles?.length ?? 0}
- Backend functions: ${report.base44Analysis?.functionFiles?.length ?? 0}
- Connectors: ${report.base44Analysis?.connectorFiles?.length ?? 0}

## Validation notes

${(report.notes ?? []).map((note) => `- ${note}`).join('\n') || '- No additional notes.'}
`;
    await fs.writeFile(markdownPath, markdown, 'utf8');
    return { jsonPath, markdownPath };
  }

  async appendHistory(entry) {
    const history = await readJson(this.historyPath, []);
    history.unshift(entry);
    await writeJson(this.historyPath, history.slice(0, 200));
  }

  async getHistory() {
    return readJson(this.historyPath, []);
  }

  async clearHistory() {
    await writeJson(this.historyPath, []);
    return [];
  }
}

module.exports = { ReportService };
