# Cota Zero · Cadastro

App de levantamento e cadastro imobiliário da **Cota Zero** (identidade em `01 Identidade`). Os desenhos seguem a ABNT NBR 6492:2021 — resumo das regras em [NORMA.md](NORMA.md).

App pessoal para iPad (web app) que recebe medidas da trena **Bosch GLM 50 C** por Bluetooth.
A pesquisa que embasou o projeto está em [PESQUISA.md](PESQUISA.md).

**Endereço do app:** https://mrpietroluis.github.io/cadastro-imoveis/ (abrir no iPad pelo navegador Bluefy)

Para publicar uma atualização: `git subtree split --prefix app -b gh-pages` e `git push origin main gh-pages --force`.

## Ferramentas (abas de cada imóvel)

- **Dados**: identificação, tipo, endereço, inscrição/matrícula, proprietário, área do terreno, data da vistoria, observações.
- **Cômodos**: largura, comprimento e pé‑direito pela trena; área, perímetro e área de paredes calculados.
- **Croqui**: arraste os cômodos para montar a planta (eles grudam nas paredes vizinhas) ou desenhe cômodos irregulares parede por parede.
- **Fotos**: fotos ligadas aos cômodos com cotas (a medida da trena entra na cota), caneta e textos.
- **Exportar**: ficha em PDF, planilha CSV (Excel) e backup/restauração em `.json`.

Liga/desliga em **⚙ Configurações**.

## Usando a trena

1. Ligue o Bluetooth da GLM 50 C (botão Bluetooth da trena).
2. No app, toque em **Conectar trena** e escolha a GLM na lista.
3. Toque num campo de medida (fica azul, "aguardando trena") e meça — pelo botão da trena ou pelo botão **Medir** no topo do app (a trena mede sozinha, sem você tocar nela). O valor entra e o próximo campo já é selecionado.
4. Medidas sem campo selecionado vão para a bandeja **Medidas** (canto inferior direito); toque nelas para usar depois.
5. O ✎ ao lado de cada campo permite digitar à mão.

## Testar no PC agora (Chrome ou Edge no Windows)

```bash
node serve.mjs
```

Abra http://localhost:8080 no Chrome/Edge. O Bluetooth funciona em `localhost`, então dá para conectar a trena direto no notebook.
Sem a trena: Configurações → **Simular medida**.

## Colocar no iPad

O iPad precisa do app aberto por um endereço **https** e pelo navegador **Bluefy** (o Safari não tem Bluetooth para sites).

1. Publique a pasta `app/` num hospedeiro https gratuito, por exemplo:
   - **Netlify Drop** (https://app.netlify.com/drop): arraste a pasta `app` para a página.
   - **GitHub Pages**: crie um repositório, envie a pasta `app` e ative Pages.
2. No iPad, instale o **Bluefy – Web BLE Browser** (App Store, gratuito) e abra o endereço publicado.
3. Na primeira conexão, permita o Bluetooth para o Bluefy.
4. O app funciona sem internet depois do primeiro acesso (service worker).

**Seus dados ficam só no iPad** (banco do navegador). Faça backups pela aba Exportar e guarde no iCloud/Arquivos.
Em Configurações, use **Proteger armazenamento** para o sistema não apagar os dados.

## Criar uma ferramenta nova

1. Crie `app/js/tools/minha-ferramenta.js` copiando o formato descrito em `app/js/tools/index.js`.
2. Registre em `TOOLS` no `index.js`.
3. Adicione o arquivo na lista `FILES` do `app/sw.js` e aumente o `VERSION` (para o iPad baixar a atualização).

Para usar a trena numa ferramenta nova, use `measureField()` de `app/js/ui.js`. Se a ferramenta tiver `report()`, ela entra no PDF automaticamente.

## Diagnóstico pelo Windows

A pasta `diagnostico/` tem dois scripts Python (biblioteca `bleak`) que falam direto com a trena, sem navegador:

```bash
python diagnostico/procurar_trena.py
```

```bash
python diagnostico/testar_trena.py
```

O primeiro lista os aparelhos Bluetooth por perto; o segundo conecta, liga o AutoSync e mede duas vezes.

## Estrutura

```
app/
  index.html, manifest.webmanifest, sw.js   # casca do app e modo offline
  css/app.css
  js/app.js        # rotas, telas Início/Imóvel/Configurações, barra da trena
  js/glm.js        # driver Bluetooth da GLM 50 C (protocolo documentado no topo)
  js/db.js         # banco local (IndexedDB)
  js/ui.js         # componentes, campo de medida, formatação
  js/geometry.js   # área/perímetro de cômodos retangulares e irregulares
  js/tools/        # ferramentas plugáveis
  vendor/jspdf.umd.min.js
serve.mjs          # servidor local de teste
```
