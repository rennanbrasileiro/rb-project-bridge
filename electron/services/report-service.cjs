'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJson, readJson } = require('../core/fs-utils.cjs');
const { assessMigrationReadiness, readinessMarkdown } = require('./readiness-service.cjs');
const { writeClientDeliveryPackage } = require('./delivery-package-service.cjs');
const { getDeliveryContext } = require('../core/delivery-context.cjs');
const { createClientArchive } = require('./client-archive-service.cjs');
function markdownEscape(value) { return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' '); }
class ReportService {
  constructor({ userDataDir, logger }) { this.userDataDir = userDataDir; this.logger = logger; this.historyPath = path.join(userDataDir, 'migration-history.json'); }
  async writeReport(directory, report) {
    const context = getDeliveryContext(report.project?.id);
    if (context) report.options = { ...(report.options || {}), deliveryPackage: context.deliveryPackage, targetProfile: context.targetProfile, clientName: context.clientName, deliveryOwner: context.deliveryOwner, migrationScope: context.migrationScope };
    report.readiness = assessMigrationReadiness(report);
    const delivery = await writeClientDeliveryPackage(directory, report);
    report.clientDelivery = { package: delivery.manifest.contractedPackage, target: delivery.manifest.targetProfile, acceptance: delivery.manifest.acceptance, directory: delivery.root, archive: null };
    const jsonPath = path.join(directory, 'RB-BRIDGE-REPORT.json');
    const markdownPath = path.join(directory, 'RB-BRIDGE-REPORT.md');
    const readinessJsonPath = path.join(directory, 'RB-MIGRATION-READINESS.json');
    const readinessMarkdownPath = path.join(directory, 'RB-MIGRATION-READINESS.md');
    await writeJson(jsonPath, report);
    await writeJson(readinessJsonPath, report.readiness);
    await fs.writeFile(readinessMarkdownPath, readinessMarkdown(report.readiness), 'utf8');
    const findings = report.security?.findings ?? []; const standalone = report.standalone;
    const runtimeContracts = report.readiness?.runtimeContracts || {};
    const markdown = `# RB Project Bridge — Relatório de entrega\n\n- **Status:** ${markdownEscape(report.status)}\n- **Gerado em:** ${markdownEscape(report.finishedAt || report.startedAt)}\n- **Projeto Base44:** ${markdownEscape(report.project?.name)}\n- **App ID:** ${markdownEscape(report.project?.id)}\n- **Pacote contratado:** ${markdownEscape(report.clientDelivery?.package?.label || report.options?.deliveryPackage || 'Não informado')}\n- **Arquitetura de destino:** ${markdownEscape(report.clientDelivery?.target?.label || report.options?.targetProfile || 'Não informada')}\n- **Modo técnico:** ${markdownEscape(report.options?.deliveryMode || 'snapshot')}\n- **GitHub:** ${markdownEscape(report.github?.fullName || 'Ainda não publicado')}\n- **Commit main:** ${markdownEscape(report.github?.sha || 'Ainda não criado')}\n- **Build:** ${markdownEscape(report.build?.status || 'Não executado')}\n- **Preview local:** ${markdownEscape(report.paths?.previewDir || report.build?.preview?.directory || 'Não gerado')}\n- **Prontidão:** ${markdownEscape(report.readiness?.label)} (${report.readiness?.score ?? 0}/100)\n- **Pacote recomendado:** ${markdownEscape(report.readiness?.recommendedPackage)}\n- **Aceite automático do contratado:** ${report.clientDelivery?.acceptance?.acceptedByAutomation ? 'Aprovado' : 'Pendente'}\n\n## Independência\n\n- Entidades Supabase: ${standalone?.entities?.length ?? 0}\n- Funções preservadas: ${standalone?.functions?.length ?? 0}\n- Gate zero Base44: ${report.standaloneGateAfterBuild?.passed || report.standaloneGateAfterPreviewRepair?.passed || report.standaloneGate?.passed ? 'Aprovado' : 'Não executado'}\n- Bloqueadores de produção: ${standalone?.blockers?.length ?? 0}\n- Contratos convertidos: ${runtimeContracts.converted ?? 0}\n- Contratos encaminhados: ${runtimeContracts.bridged ?? 0}\n- Contratos emulados: ${runtimeContracts.emulated ?? 0}\n- Contratos não suportados: ${runtimeContracts.unsupported ?? 0}\n\n${standalone?.blockers?.length ? standalone.blockers.map((item) => `- ${item}`).join('\n') : '- Nenhum bloqueador estrutural registrado.'}\n\n## Segurança\n\n- Arquivos analisados: ${report.security?.scannedFiles ?? 0}\n- Achados: ${findings.length}\n- Bloqueantes: ${report.security?.blocking?.length ?? 0}\n- Caminhos removidos: ${report.sanitization?.removed?.length ?? 0}\n\n${findings.length ? `| Severidade | Regra | Arquivo | Linha |\n|---|---|---|---:|\n${findings.map((item) => `| ${item.severity} | ${item.rule} | ${markdownEscape(item.file)} | ${item.line} |`).join('\n')}` : 'Nenhum segredo encontrado.'}\n\n## Inventário Base44 original\n\n- Referências SDK: ${report.base44Analysis?.sdkImports ?? 0}\n- Entidades: ${report.base44Analysis?.entityFiles?.length ?? 0}\n- Funções: ${report.base44Analysis?.functionFiles?.length ?? 0}\n- Conectores: ${report.base44Analysis?.connectorFiles?.length ?? 0}\n\n## Entrega ao cliente\n\nA pasta [CLIENT_DELIVERY](CLIENT_DELIVERY/) contém o manifesto, o guia de handoff, o checklist de aceite, o blueprint de implantação, o checklist de credenciais e o backlog de migração.\n\nConsulte também [RB-MIGRATION-READINESS.md](RB-MIGRATION-READINESS.md), [RUNTIME_COMPATIBILITY.md](RUNTIME_COMPATIBILITY.md) e [DEVELOPMENT_WORKSPACE.md](DEVELOPMENT_WORKSPACE.md).\n`;
    await fs.writeFile(markdownPath, markdown, 'utf8');
    const archive = await createClientArchive(directory, report);
    if (archive) { report.clientDelivery.archive = archive; await writeJson(jsonPath, report); }
    return { jsonPath, markdownPath, readinessJsonPath, readinessMarkdownPath, clientDeliveryDirectory: delivery.root, clientDeliveryArchive: archive?.path || null };
  }
  async appendHistory(entry) { const history = await readJson(this.historyPath, []); history.unshift(entry); await writeJson(this.historyPath, history.slice(0, 200)); }
  async getHistory() { return readJson(this.historyPath, []); }
  async clearHistory() { await writeJson(this.historyPath, []); return []; }
}
module.exports = { ReportService };
