'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJson, readJson } = require('../core/fs-utils.cjs');
const { assessMigrationReadiness, readinessMarkdown } = require('./readiness-service.cjs');
function markdownEscape(value) { return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' '); }
class ReportService {
  constructor({ userDataDir, logger }) { this.userDataDir = userDataDir; this.logger = logger; this.historyPath = path.join(userDataDir, 'migration-history.json'); }
  async writeReport(directory, report) {
    report.readiness = assessMigrationReadiness(report);
    const jsonPath = path.join(directory, 'RB-BRIDGE-REPORT.json');
    const markdownPath = path.join(directory, 'RB-BRIDGE-REPORT.md');
    const readinessJsonPath = path.join(directory, 'RB-MIGRATION-READINESS.json');
    const readinessMarkdownPath = path.join(directory, 'RB-MIGRATION-READINESS.md');
    await writeJson(jsonPath, report);
    await writeJson(readinessJsonPath, report.readiness);
    await fs.writeFile(readinessMarkdownPath, readinessMarkdown(report.readiness), 'utf8');
    const findings = report.security?.findings ?? []; const standalone = report.standalone;
    const runtimeContracts = report.readiness?.runtimeContracts || {};
    const markdown = `# RB Project Bridge — Relatório de entrega\n\n- **Status:** ${markdownEscape(report.status)}\n- **Gerado em:** ${markdownEscape(report.finishedAt || report.startedAt)}\n- **Projeto Base44:** ${markdownEscape(report.project?.name)}\n- **App ID:** ${markdownEscape(report.project?.id)}\n- **Modo:** ${markdownEscape(report.options?.deliveryMode || 'snapshot')}\n- **GitHub:** ${markdownEscape(report.github?.fullName || 'Ainda não publicado')}\n- **Commit main:** ${markdownEscape(report.github?.sha || 'Ainda não criado')}\n- **Build:** ${markdownEscape(report.build?.status || 'Não executado')}\n- **Preview local:** ${markdownEscape(report.paths?.previewDir || report.build?.preview?.directory || 'Não gerado')}\n- **Prontidão:** ${markdownEscape(report.readiness?.label)} (${report.readiness?.score ?? 0}/100)\n- **Pacote recomendado:** ${markdownEscape(report.readiness?.recommendedPackage)}\n\n## Independência\n\n- Entidades Supabase: ${standalone?.entities?.length ?? 0}\n- Funções preservadas: ${standalone?.functions?.length ?? 0}\n- Gate zero Base44: ${report.standaloneGateAfterBuild?.passed || report.standaloneGateAfterPreviewRepair?.passed || report.standaloneGate?.passed ? 'Aprovado' : 'Não executado'}\n- Bloqueadores de produção: ${standalone?.blockers?.length ?? 0}\n- Contratos convertidos: ${runtimeContracts.converted ?? 0}\n- Contratos encaminhados: ${runtimeContracts.bridged ?? 0}\n- Contratos emulados: ${runtimeContracts.emulated ?? 0}\n- Contratos não suportados: ${runtimeContracts.unsupported ?? 0}\n\n${standalone?.blockers?.length ? standalone.blockers.map((item) => `- ${item}`).join('\n') : '- Nenhum bloqueador estrutural registrado.'}\n\n## Segurança\n\n- Arquivos analisados: ${report.security?.scannedFiles ?? 0}\n- Achados: ${findings.length}\n- Bloqueantes: ${report.security?.blocking?.length ?? 0}\n- Caminhos removidos: ${report.sanitization?.removed?.length ?? 0}\n\n${findings.length ? `| Severidade | Regra | Arquivo | Linha |\n|---|---|---|---:|\n${findings.map((item) => `| ${item.severity} | ${item.rule} | ${markdownEscape(item.file)} | ${item.line} |`).join('\n')}` : 'Nenhum segredo encontrado.'}\n\n## Inventário Base44 original\n\n- Referências SDK: ${report.base44Analysis?.sdkImports ?? 0}\n- Entidades: ${report.base44Analysis?.entityFiles?.length ?? 0}\n- Funções: ${report.base44Analysis?.functionFiles?.length ?? 0}\n- Conectores: ${report.base44Analysis?.connectorFiles?.length ?? 0}\n\nConsulte também [RB-MIGRATION-READINESS.md](RB-MIGRATION-READINESS.md), [RUNTIME_COMPATIBILITY.md](RUNTIME_COMPATIBILITY.md) e [DEVELOPMENT_WORKSPACE.md](DEVELOPMENT_WORKSPACE.md).\n`;
    await fs.writeFile(markdownPath, markdown, 'utf8');
    return { jsonPath, markdownPath, readinessJsonPath, readinessMarkdownPath };
  }
  async appendHistory(entry) { const history = await readJson(this.historyPath, []); history.unshift(entry); await writeJson(this.historyPath, history.slice(0, 200)); }
  async getHistory() { return readJson(this.historyPath, []); }
  async clearHistory() { await writeJson(this.historyPath, []); return []; }
}
module.exports = { ReportService };
