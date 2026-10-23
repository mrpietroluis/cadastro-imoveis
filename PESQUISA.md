# Pesquisa: apps de medição com trena Bluetooth e o protocolo da Bosch GLM 50 C

## 1. Como os apps existentes funcionam

Todos seguem o mesmo esquema: a trena faz a medida e manda o número por Bluetooth; o app só **recebe o número e coloca no lugar certo** (um campo, uma parede do croqui ou uma cota numa foto). Nenhum deles controla a medição de verdade — quem aperta o botão é você, na trena.

| App | O que faz | Trena Bosch | Observações |
|---|---|---|---|
| **Bosch MeasureOn** (oficial) | Área de trabalho infinita com croquis por cômodo, fotos com cotas, notas; calcula área de piso, de parede e perímetro | GLM 50 C, 100 C, 400 C, 165‑27 C/CG | Gratuito exporta croquis/fotos; PDF e DXF com logo só na versão PRO (assinatura). Substituiu os antigos "GLM measure & document" e "GLM floor plan". |
| **magicplan** | Planta baixa por cômodo, orçamentos, relatórios | Vários lasers Bluetooth | Foco em reforma/orçamento; plano pago. |
| **Live Home 3D** | Projeto 2D/3D de interiores | GLM 400 C, 165‑27 C/CG | Medida entra na parede selecionada. |
| **OrthoGraph** | Levantamento de plantas para engenharia | Leica, Bosch, Stabila | Mais técnico (as‑built). |
| **Floor Plan Creator** | Planta baixa | GLM 120 C | A versão web usa Web Bluetooth (não roda no Safari). |

**Padrões que valem copiar** (e que o seu app já usa):
1. **Campo "armado"**: você toca no campo e a próxima medida da trena cai nele (MeasureOn faz igual).
2. **Avanço automático**: depois da largura já vai para o comprimento, depois para o pé‑direito.
3. **Croqui por paredes**: mede parede por parede no sentido horário, escolhendo a direção; o app fecha o contorno e calcula a área (magicplan/MeasureOn).
4. **Cotas na foto**: risca uma linha na foto e a próxima medida vira o texto da cota.
5. **Exportação** em PDF + planilha.

O que eles **não** fazem bem para cadastro imobiliário — e é o motivo de um app próprio: campos de cadastro (inscrição, matrícula, proprietário), ficha padronizada, funcionar sem assinatura e poder adicionar ferramentas suas.

## 2. Protocolo Bluetooth da GLM 50 C

A GLM 50 C tem Bluetooth "dual mode": **serial clássico** (usado por Android/Windows) e **Bluetooth Low Energy** (o único que o iPad deixa usar sem certificação MFi da Apple).

### Testado na sua trena (23/10/2026)

Conectei direto na **Bosch GLM50C x3269** (código de peça `3601K72C00`) pelo Bluetooth do Windows e mapeei tudo:

| Item | Valor real |
|---|---|
| Nome anunciado | `Bosch GLM50C x3269` (não anuncia UUID de serviço) |
| Serviço | `00005301-0000-0041-5253-534f46540000` (porta "antiga" do MT‑Protocol) |
| Característica | `00004301-0000-0041-5253-534f46540000` — write + indicate |
| Formato | comando `C0 <cmd> <n> <dados> <crc>` → resposta `<status> <n> <dados> <crc>` (status 0 = ok) |
| Identificação | `C0 06 00 4A` → 29 bytes com o código `3601K72C00` |
| Envio automático (AutoSync) | `C0 55 02 01 00 1A` → aceito (status 0) |
| **Medir pelo app** | `C0 40 00 EE` → `00 04 <u32 LE> <crc>`, distância = u32 × 0,05 mm. Ex.: `f8 8b 00 00` = **1,7916 m**. Funciona com o laser desligado. |
| Laser liga / desliga | `C0 41 00 96` / `C0 42 00 1E` |

**Por que a primeira versão não conectava:** ela procurava o serviço `02a6c0d0-…` que a comunidade publicou para modelos mais novos (GLM 50‑27 C(G), 120 C, 400 C). Esta GLM 50 C usa o serviço antigo `00005301-…`. O app agora tenta os dois.

O driver do app (`app/js/glm.js`) foi rodado contra a trena real: conectou, leu o código, ligou o AutoSync e mediu à distância (1,7915 m e 1,7913 m).

**Ainda não confirmado na sua trena:** o pacote que chega quando você aperta o **botão físico** com o AutoSync ligado. Pelo projeto ESP32 e pela resposta do AutoSync (16 bytes no mesmo formato), deve ser `C0 55 10 …` com a distância em float32 (metros) nos bytes 7–10 — é o que o app espera. O botão **Medir** do app não depende disso.

### Modelos mais novos (referência da comunidade)

| Item | Valor |
|---|---|
| Serviço | `02a6c0d0-0451-4000-b000-fb3210111989` |
| Característica (write + indicate) | `02a6c0d1-0451-4000-b000-fb3210111989` |
| Ligar AutoSync | `C0 55 02 01 00 1A` |
| Cada medida chega como | `C0 55 10 06 …` — distância em float32 LE (metros) nos bytes 7–10 |

O byte final de cada comando é um **CRC‑8 (polinômio 0xA6, valor inicial 0xAA)**. Todas as respostas da sua trena fecharam esse CRC.

### Serial clássico (referência, não usado no iPad)

Comandos de 4 bytes `C0 xx 00 CRC`: medir `C0 40 00 EE`, laser liga `C0 41 00 96`, laser desliga `C0 42 00 1E`, luz de fundo `C0 47 00 20` / `C0 48 00 62`. A resposta traz a distância em inteiro de 32 bits × 0,05 mm nos bytes 2–5.

**Ponto de atenção:** não há documentação oficial da Bosch. Os comandos acima foram conferidos na sua trena; firmwares de outros modelos podem variar.

## 3. Como rodar no iPad sem Mac

| Caminho | Custo | Mac? | Prós | Contras |
|---|---|---|---|---|
| **Web app + navegador Bluefy** ✅ escolhido | Grátis | Não | Pronto hoje, testa no Chrome do Windows, atualiza sem reinstalar, funciona offline | O Safari **não** tem Web Bluetooth (a Apple diz que não vai implementar), então no iPad tem que abrir pelo Bluefy |
| App nativo SwiftUI + CoreBluetooth | Grátis (reinstala a cada 7 dias) ou US$ 99/ano | Sim | Integração total, ícone na tela inicial com Bluetooth | Precisa de Mac e Xcode |
| Expo / React Native compilado na nuvem | US$ 99/ano (Apple Developer) | Não | App nativo de verdade | Conta paga, mais complexo |

Como o código do app é separado em módulos (driver da trena, banco, ferramentas), dá para migrar para nativo depois reaproveitando a lógica: só o `glm.js` muda para CoreBluetooth.

## Fontes

- [Gist ESP32 + GLM 50 C (UUIDs, comando AutoSync e offsets)](https://gist.github.com/ketan/054e9f4173aa53a04218fc545241f634)
- [pymtprotocol — reimplementação do MT‑Protocol (CRC‑8, SyncContainer)](https://github.com/piannucci/pymtprotocol)
- [philipptrenz/BOSCH-GLM-rangefinder — serial clássico GLM 100 C / 50 C](https://github.com/philipptrenz/BOSCH-GLM-rangefinder)
- [Fórum B4X — GLM 50 C, comandos e decodificação](https://b4x.com/android/forum/threads/bosch-distance-laser-glm-serie.160011/page-2)
- [Nordic DevZone — sniffing da GLM 120 C (mesmos UUIDs)](https://devzone.nordicsemi.com/f/nordic-q-a/80589/sniffing-a-bosch-laser-tape-2)
- [Bosch MeasureOn na App Store](https://apps.apple.com/us/app/bosch-measureon/id1515070546) · [página Bosch MeasureOn](https://bosch-professional.com/gb/en/measureon) · [review Pro Tool Reviews](https://www.protoolreviews.com/tools/test-and-measurement/bosch-measureon-app-ios-android/29985/)
- [Live Home 3D + Bosch](https://www.livehome3d.com/fields-of-use/bosch-laser-measure-integration-with-live-home-3d) · [Floor Plan Creator — lasers Bluetooth](https://floorplancreator.net/help/bluetooth) · [OrthoGraph](https://en.wikipedia.org/wiki/OrthoGraph)
- [Bluefy – Web BLE Browser (App Store)](https://apps.apple.com/app/id1492822055) · [WebKit sobre Web Bluetooth](https://lists.w3.org/Archives/Public/public-web-bluetooth/2024Sep/0002.html)
