# Regras de desenho — ABNT NBR 6492:2021

Todo desenho gerado pelo app (prancha em PDF, arquivo CAD e croqui) segue a **ABNT NBR 6492:2021 — Documentação técnica para projetos arquitetônicos e urbanísticos**.
O arquivo original da norma fica só neste computador, em `referencias/` (fora do GitHub, porque é material protegido da ABNT). Abaixo está o resumo, com minhas palavras, do que foi aplicado e onde.

| Item da norma | Regra | Onde está no app |
|---|---|---|
| 4.3 Formatos | Folhas da série A (A0 a A4) | Prancha A3 paisagem; ficha A4 |
| 4.4 Dobramento | Aba de arquivamento à esquerda; carimbo sempre visível | Margem esquerda de 25 mm |
| 4.5 Carimbo | Canto inferior direito, na largura de uma A4 | Carimbo de 178 mm |
| 4.5.1 Conteúdo mínimo do carimbo | Empresa, cliente/projeto, título, numeração, escala, local e data, autoria, responsável técnico, revisão, chancela | Todos os campos presentes |
| 4.5.2 Acima do carimbo | Escala gráfica, revisões, notas gerais, legendas/convenções | Quadros, notas, escala gráfica, norte e revisões na coluna da direita |
| A.1 Tipos de linha | Contínua extralarga para contorno cortado sem hachura; larga/estreita para esquadrias e arestas; estreita para cotas | Paredes = extralarga; portas e janelas = larga; giro de porta e cotas = estreita |
| A.1.3 Pesos (Tabela A.2) | Grupos 1 : ½ : ¼ escolhidos pela escala | 1:50 → 0,70 / 0,35 / 0,18 mm; 1:100 ou maior → 0,50 / 0,25 / 0,13 mm |
| A.2 Letras | Sem serifa, traço uniforme, maiúsculas, sem itálico | Helvetica em maiúsculas (unidades como m² ficam em minúsculas) |
| A.2.2 Alturas (Tabela A.3) | 7 mm título da prancha; 5 mm título do desenho; 3,5 mm ambientes; 2,5 mm cotas; 1,8 mm quando faltar espaço | Mesmas alturas na prancha e no DXF (convertidas pela escala) |
| A.3.1 Escalas usuais | 1:1, 1:2, 1:5, 1:10, 1:20, 1:25, 1:50, 1:100, 1:200, 1:250, 1:500, 1:1000, 1:2000 | O app escolhe sozinho a maior escala usual que cabe na folha |
| A.3.2 Escala gráfica | Barra com divisões | Ao lado do norte, acima do carimbo |
| A.4.1 Norte | Círculo com a indicação do norte | Desenhado pela direção informada; sem ela, aparece a nota "a confirmar no local" |
| A.5.1 Cotas | Em metros; fora do desenho; chamada parando a 2–3 mm; cifra de 2,5 mm sem encostar na linha; limites a 45°; não duplicar | Correntes externas nos quatro lados + total; marcas a 45°; cotas internas por ambiente |
| A.5.2 Vãos | Cotar os vãos de portas e janelas | As correntes externas incluem as bordas de cada vão |
| A.7 Títulos | Desenhos numerados, título com escala | "① PLANTA BAIXA — ESCALA 1:50" |
| A.8.1 Esquadrias | P1…Pn e J1…Jn; largura × altura; peitoril na janela; círculo de 7 mm | Designação automática; esquadrias iguais recebem a mesma sigla |
| A.8.2 Ambientes | Nome em todos os compartimentos | Nome, área e pé-direito no centro de cada ambiente |
| A.9.2 / A.9.3 Quadros | Quadro de áreas e quadro de esquadrias | Os dois na prancha, com quantidade por tipo |

## Arquivo CAD (DXF)

- Unidade: metro. Formato AutoCAD R12 (abre no AutoCAD, ZWCAD, BricsCAD, LibreCAD).
- Camadas por função, com cores no padrão de penas: `ARQ-PAREDE` (7, extralarga), `ARQ-MEIA-PAREDE` e `ARQ-ESQUADRIA` (4, larga), `ARQ-ESQUADRIA-GIRO` e `ARQ-COTA` (1, estreita), `ARQ-TEXTO` (3), `ARQ-DESIGNACAO` (2).
- Alturas de texto calculadas para sair com 3,5 mm e 2,5 mm impressos na escala da prancha.

## O que ainda falta para cobrir a norma toda

- **Espessura real das paredes:** hoje o levantamento registra as faces internas, e as paredes saem como uma linha extralarga. Desenhar as duas faces de cada parede exige medir a espessura em cada trecho.
- **Hachuras de materiais (A.10)**, **cotas de nível (A.5.3)**, **cortes e fachadas com simbologia (A.4.6, A.4.7, A.6.2)**, **eixos (A.6.1)** e **planta-chave**: entram quando os serviços de cortes e fachadas ganharem as telas próprias deles.
