from pathlib import Path

path = Path('scripts/apply-0.2.3-resilience.py')
text = path.read_text(encoding='utf-8')
old = '''old_repo_ui = '<div class="grid two"><label>Conta GitHub<select id="owner"></select></label><label>Nome do repositório<input id="repoName" placeholder="meu-produto"></label></div>\\n       <label>Descrição<input id="description" placeholder="Aplicação independente preparada pelo RB Project Bridge"></label>'
new_repo_ui = '<div class="grid two"><label>Conta GitHub<select id="owner"></select></label><label>Destino<select id="repoChoice"><option value="">Conecte o GitHub para carregar</option></select></label></div>\\n       <label id="newRepoLabel" class="hidden">Nome do novo repositório<input id="repoName" placeholder="meu-produto"></label>\\n       <div id="repoSyncStatus" class="private-lock"><strong>Seleção inteligente</strong><span>Escolha um repositório existente ou selecione “Criar novo”. O Bridge não criará outro repositório por erro de digitação.</span></div>\\n       <label>Descrição<input id="description" placeholder="Aplicação independente preparada pelo RB Project Bridge"></label>'
if old_repo_ui not in index:
    raise SystemExit('Could not patch repository UI')
index = index.replace(old_repo_ui, new_repo_ui, 1)
'''
new = '''new_repo_ui = '<div class="grid two"><label>Conta GitHub<select id="owner"></select></label><label>Destino<select id="repoChoice"><option value="">Conecte o GitHub para carregar</option></select></label></div>\\n       <label id="newRepoLabel" class="hidden">Nome do novo repositório<input id="repoName" placeholder="meu-produto"></label>\\n       <div id="repoSyncStatus" class="private-lock"><strong>Seleção inteligente</strong><span>Escolha um repositório existente ou selecione “Criar novo”. O Bridge não criará outro repositório por erro de digitação.</span></div>\\n       <label>Descrição<input id="description" placeholder="Aplicação independente preparada pelo RB Project Bridge"></label>'
repo_ui_pattern = re.compile(r'<div class="grid two"><label>Conta GitHub<select id="owner"></select></label><label>Nome do repositório<input id="repoName" placeholder="meu-produto"></label></div>\\s*<label>Descrição<input id="description" placeholder="Aplicação independente preparada pelo RB Project Bridge"></label>')
index, repo_ui_count = repo_ui_pattern.subn(new_repo_ui, index, count=1)
if repo_ui_count != 1:
    raise SystemExit('Could not patch repository UI')
'''
if old not in text:
    raise SystemExit('UI patch block not found in patcher')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
