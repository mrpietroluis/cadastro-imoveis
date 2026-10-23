// Registro de ferramentas. Para criar uma nova, copie um arquivo desta pasta, mude o id/nome
// e adicione aqui. Ela aparece em Configurações para ligar/desligar.
//
// Formato de uma ferramenta:
//   {
//     id: 'minha-ferramenta',          // único, sem espaços
//     name: 'Nome da aba',
//     description: 'Aparece em Configurações',
//     defaultEnabled: true,            // opcional
//     async render(body, ctx) {},      // desenha a aba dentro de `body`
//     async report(ctx) { return [] }, // opcional: blocos para o PDF
//   }
// ctx = { property, db, glm, toast, tools, saveProperty(patch), rerender() }
// Blocos de report: { type: 'table', title, head: [], rows: [[]] }
//                   { type: 'image', title, dataUrl, w, h, group? }
// Para usar a trena, crie campos com measureField() de ../ui.js.

import rooms from './rooms.js';
import sketch from './sketch.js';
import photos from './photos.js';
import exportTool from './export.js';

export const TOOLS = [rooms, sketch, photos, exportTool];
