'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { copyDirectory, safeSlug, writeJson, readJson, pathExists } = require('../core/fs-utils.cjs');
const { BridgeError } = require('../core/errors.cjs');

class MigrationService {
  constructor(services) { Object.assign(this, services); this.controller = null; }
  cancel() { if (this.controller) this.controller.abort(); return { cancelled:Boolean(this.controller) }; }
  progress(step,status,message) { this.emit('migration:progress',{step,status,message}); }
  async migrate(input) {
    if (this.controller) throw new BridgeError('MIGRATION_RUNNING','A migration is already running.');
    this.controller=new AbortController(); const signal=this.controller.signal;
    const startedAt=new Date().toISOString(), jobId=randomUUID(); const slug=safeSlug(input.project.name); const stamp=startedAt.replace(/[:.]/g,'-'); const jobRoot=path.join(input.outputDirectory,`${slug}-${stamp}`); const originalDir=path.join(jobRoot,'source-backup'); const repoDir=path.join(jobRoot,'repository'); const backupPath=path.join(jobRoot,`${slug}-base44-source.zip`);
    const report={jobId,status:'running',startedAt,project:input.project,repository:input.repository,notes:['Database records, users, secrets, OAuth grants and storage are not migrated automatically.']};
    try {
      await fs.mkdir(jobRoot,{recursive:true});
      report.export=await this.base44.exportProject(input.project,originalDir,{signal});
      report.exportTree=await this.security.validateExportTree(originalDir); if (!report.exportTree.valid) throw new BridgeError('UNSAFE_EXPORT_TREE','The export contains symbolic links or unsupported files.',report.exportTree);
      report.backup=await this.archive.createZip(originalDir,backupPath); await copyDirectory(originalDir,repoDir);
      this.progress('sanitize','running','Removing local and sensitive files...'); report.sanitization=await this.security.sanitize(repoDir);
      report.security=await this.security.scan(repoDir); if (report.security.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED','Secrets were detected. Publication was blocked.',{findings:report.security.blocking});
      report.base44Analysis=await this.security.analyzeBase44Dependencies(repoDir); report.build=await this.build.validateBuild(repoDir,Boolean(input.buildValidation),signal);
      if (report.build.status==='failed') throw new BridgeError('BUILD_VALIDATION_FAILED','Project validation failed.',report.build);
      report.githubRepository=await this.github.createRepository(input.repository,{signal});
      report.github=await this.github.publish({directory:repoDir,repository:report.githubRepository,commitMessage:input.repository.commitMessage,signal});
      report.status='completed'; report.finishedAt=new Date().toISOString(); const paths=await this.reports.writeReport(jobRoot,report); report.reportPaths=paths;
      await writeJson(path.join(jobRoot,'.rb-bridge-job.json'),{jobRoot,repoDir,report,input:{repository:input.repository},githubRepository:report.githubRepository});
      await this.reports.appendHistory({jobId,status:report.status,project:input.project.name,repository:report.github.fullName,startedAt,finishedAt:report.finishedAt,jobRoot}); return report;
    } catch (error) {
      report.status=signal.aborted?'cancelled':'failed'; report.finishedAt=new Date().toISOString(); report.error={code:error.code||'UNEXPECTED_ERROR',message:error.message,details:error.details}; await this.reports.writeReport(jobRoot,report).catch(()=>null); await this.reports.appendHistory({jobId,status:report.status,project:input.project.name,startedAt,finishedAt:report.finishedAt,jobRoot,error:report.error}); throw error;
    } finally { this.controller=null; }
  }
  async retryPublish(jobRoot) {
    const statePath=path.join(jobRoot,'.rb-bridge-job.json'); if (!(await pathExists(statePath))) throw new BridgeError('RETRY_STATE_MISSING','Migration retry state was not found.'); const state=await readJson(statePath); const resolved=path.resolve(jobRoot), repoDir=path.resolve(state.repoDir||''); if (!repoDir.startsWith(`${resolved}${path.sep}`)) throw new BridgeError('INVALID_RETRY_PATH','Retry repository path is outside the migration directory.'); const security=await this.security.scan(repoDir); if (security.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED','Secrets were detected before retry.',{findings:security.blocking}); return this.github.publish({directory:repoDir,repository:state.githubRepository,commitMessage:state.input?.repository?.commitMessage});
  }
}
module.exports = { MigrationService };
