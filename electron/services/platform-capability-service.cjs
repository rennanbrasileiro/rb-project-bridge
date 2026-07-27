'use strict';

const PLATFORM_CAPABILITIES = Object.freeze({
  base44: {
    id: 'base44',
    label: 'Base44',
    roles: ['source'],
    codeExport: 'supported',
    githubImport: 'not-applicable',
    githubSync: 'supported',
    backendPortability: 'partial',
    dataPortability: 'separate-export',
    continuation: ['github', 'local-ide', 'emergent', 'bolt'],
    limitations: ['Exported code does not include a populated independent database.', 'Users, password hashes and storage require a separate migration plan.'],
  },
  lovable: {
    id: 'lovable',
    label: 'Lovable',
    roles: ['source', 'continuation-existing-link'],
    codeExport: 'github-sync',
    githubImport: 'not-supported-for-new-project',
    githubSync: 'supported',
    backendPortability: 'manual',
    dataPortability: 'manual',
    continuation: ['github', 'local-ide', 'existing-lovable-project'],
    limitations: ['An arbitrary existing GitHub repository cannot currently be imported as a new Lovable project.', 'Lovable Cloud to Supabase migration requires manual handling of auth, storage, data and secrets.'],
  },
  emergent: {
    id: 'emergent',
    label: 'Emergent',
    roles: ['source', 'continuation'],
    codeExport: 'github',
    githubImport: 'supported',
    githubSync: 'supported',
    backendPortability: 'stack-dependent',
    dataPortability: 'stack-dependent',
    continuation: ['github', 'emergent', 'local-ide'],
    limitations: ['Backend can vary between FastAPI/MongoDB, Supabase and other integrations.', 'Environment variables and external resources must be recreated outside the platform.'],
  },
  bolt: {
    id: 'bolt',
    label: 'Bolt',
    roles: ['source', 'continuation'],
    codeExport: 'github-or-download',
    githubImport: 'supported',
    githubSync: 'supported',
    backendPortability: 'partial',
    dataPortability: 'migration-dependent',
    continuation: ['github', 'bolt', 'local-ide'],
    limitations: ['Bolt Database and Supabase projects have different migration paths.', 'Secrets and provider resources are not portable through source code alone.'],
  },
  github: {
    id: 'github',
    label: 'GitHub / repositório existente',
    roles: ['source', 'canonical', 'continuation'],
    codeExport: 'native',
    githubImport: 'native',
    githubSync: 'native',
    backendPortability: 'inspect',
    dataPortability: 'inspect',
    continuation: ['local-ide', 'emergent', 'bolt', 'deployment-provider'],
    limitations: ['Repository content alone may not contain managed databases, users, storage or provider configuration.'],
  },
  archive: {
    id: 'archive',
    label: 'ZIP ou pasta local',
    roles: ['source'],
    codeExport: 'provided',
    githubImport: 'bridge-publishes',
    githubSync: 'after-publication',
    backendPortability: 'inspect',
    dataPortability: 'inspect',
    continuation: ['github', 'local-ide', 'emergent', 'bolt'],
    limitations: ['Provenance and source version must be supplied or inferred.', 'Managed resources absent from the archive cannot be recreated automatically without credentials and exports.'],
  },
});

class PlatformCapabilityService {
  list() { return Object.values(PLATFORM_CAPABILITIES); }
  get(id) { return PLATFORM_CAPABILITIES[id] || null; }
  recommendContinuations(id) {
    const platform = this.get(id);
    if (!platform) return [];
    return platform.continuation.map((target) => ({ target, reason: target === 'github' ? 'GitHub is the canonical portable asset.' : 'Available according to the current platform contract.' }));
  }
  assess(id, requestedResult) {
    const platform = this.get(id);
    if (!platform) return { supported: false, blockers: ['Unknown source platform.'] };
    const blockers = [];
    if (requestedResult === 'round-trip' && platform.githubImport === 'not-supported-for-new-project') blockers.push(`${platform.label} cannot import an arbitrary repository as a new project.`);
    if (requestedResult === 'production' && ['manual', 'partial', 'stack-dependent', 'inspect'].includes(platform.backendPortability)) blockers.push('Backend resources require discovery, migration and functional verification.');
    return { supported: blockers.length === 0, platform, blockers, recommendedContinuations: this.recommendContinuations(id) };
  }
}

module.exports = { PlatformCapabilityService, PLATFORM_CAPABILITIES };
