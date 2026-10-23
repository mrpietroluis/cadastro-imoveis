// Catálogo de serviços. Cada serviço define a ficha (seções e campos), os problemas comuns com a
// solução sugerida e os entregáveis. Para criar ou mudar um serviço, edite só este arquivo.
//
// Seção:   { title, when?, tool?, fields }  — tool: 'plan' abre a tela de planta baixa (cômodos + desenho)
//          e a entrega passa a gerar a prancha da planta (PDF) e o arquivo CAD (DXF).
// Campo:   { id, label, type, options?, bind?, when?, hint?, placeholder?, calc? }
//   type:  text | textarea | number | measure (trena) | area (m²) | select | multi | check | date | photo | rooms | calc
//   bind:  grava direto no cadastro do imóvel (name, address, registry, owner, landArea…)
//   when:  só aparece se a opção do serviço com esse id estiver marcada
//   calc:  (valores) => texto calculado (só leitura)
// Problema: { id, problem, solution, docs?: [], when? }
// Opções do serviço: mode 'multi' (marcar várias) ou 'single' (escolher uma).

const sim = (v) => v === true;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const m2 = (n) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;

function diffArea(a, b, nomeA, nomeB) {
  return (v) => {
    const x = num(v[a]);
    const y = num(v[b]);
    if (x == null || y == null || !x) return 'Preencha as duas áreas.';
    const d = y - x;
    const pct = (d / x) * 100;
    if (Math.abs(d) < 0.01) return `${nomeB} igual à ${nomeA}.`;
    return `${nomeB} ${d > 0 ? 'maior' : 'menor'} em ${m2(Math.abs(d))} (${Math.abs(pct).toFixed(1).replace('.', ',')}%).`;
  };
}

// ---------- blocos reutilizados ----------
const IMOVEL = {
  title: 'Dados do imóvel',
  fields: [
    { id: 'endereco', label: 'Endereço', type: 'text', bind: 'address' },
    { id: 'matricula', label: 'Matrícula nº', type: 'text', bind: 'registry' },
    { id: 'cartorio', label: 'Cartório de Registro de Imóveis', type: 'text', placeholder: 'Ex.: 1º CRI de …' },
    { id: 'inscricao', label: 'Inscrição imobiliária (IPTU)', type: 'text' },
    { id: 'proprietario', label: 'Proprietário(s) na matrícula', type: 'text', bind: 'owner' },
    { id: 'contato', label: 'Contato do cliente', type: 'text', placeholder: 'Telefone / e-mail' },
  ],
};

const VISITA = {
  title: 'Visita ao local',
  fields: [
    { id: 'dataVisita', label: 'Data da visita', type: 'date', bind: 'visitDate' },
    { id: 'acompanhante', label: 'Quem acompanhou', type: 'text' },
    { id: 'acesso', label: 'Acesso aos ambientes', type: 'select', options: ['Todos acessíveis', 'Parcial', 'Sem acesso'] },
    { id: 'fotoGeral', label: 'Foto geral do imóvel', type: 'photo' },
  ],
};

const CONFRONTACOES = {
  title: 'Medidas e confrontações do terreno',
  fields: [
    { id: 'frente', label: 'Frente', type: 'measure' },
    { id: 'confFrente', label: 'Confronta na frente com', type: 'text', placeholder: 'Ex.: Rua das Flores' },
    { id: 'ladoDireito', label: 'Lado direito (de quem olha da rua)', type: 'measure' },
    { id: 'confDireito', label: 'Confronta à direita com', type: 'text', placeholder: 'Ex.: lote 12 de Fulano' },
    { id: 'ladoEsquerdo', label: 'Lado esquerdo', type: 'measure' },
    { id: 'confEsquerdo', label: 'Confronta à esquerda com', type: 'text' },
    { id: 'fundos', label: 'Fundos', type: 'measure' },
    { id: 'confFundos', label: 'Confronta nos fundos com', type: 'text' },
    { id: 'areaTerreno', label: 'Área do terreno', type: 'area', bind: 'landArea' },
    { id: 'marcos', label: 'Marcos/divisas visíveis no local', type: 'check' },
  ],
};

const CONSTRUCAO = {
  title: 'Construção',
  fields: [
    { id: 'pavimentos', label: 'Nº de pavimentos', type: 'number' },
    { id: 'areaConstruida', label: 'Área construída', type: 'area' },
    { id: 'padrao', label: 'Padrão de acabamento', type: 'select', options: ['Baixo', 'Normal', 'Alto'] },
    { id: 'estrutura', label: 'Estrutura', type: 'select', options: ['Concreto armado', 'Alvenaria estrutural', 'Metálica', 'Madeira', 'Mista'] },
    { id: 'cobertura', label: 'Cobertura', type: 'select', options: ['Telha cerâmica', 'Telha de fibrocimento', 'Telha metálica', 'Laje impermeabilizada', 'Outra'] },
    { id: 'conservacao', label: 'Estado de conservação', type: 'select', options: ['Novo', 'Bom', 'Regular', 'Precisa de reparos', 'Ruim'] },
    { id: 'idade', label: 'Idade aproximada (anos)', type: 'number' },
    { id: 'ambientes', label: 'Ambientes e áreas', type: 'rooms' },
  ],
};

// ---------- serviços ----------
export const SERVICES = [
  {
    id: 'levantamento',
    name: 'Levantamento cadastral',
    subtitle: 'Planta do existente',
    description: 'Medição do imóvel para desenhar a planta baixa com as áreas de cada ambiente.',
    mode: 'multi',
    options: [
      { id: 'planta', label: 'Planta baixa com áreas', fixed: true },
      { id: 'cortesFachadas', label: 'Cortes e fachadas' },
      { id: 'instalacoes', label: 'Pontos de instalação (tomadas, água e esgoto)' },
      { id: 'modelo3d', label: 'Entrega em modelo 3D' },
    ],
    sections: [
      IMOVEL,
      VISITA,
      {
        title: 'Planta baixa',
        tool: 'plan',
        fields: [
          { id: 'peDireito', label: 'Pé-direito padrão', type: 'measure' },
          { id: 'espParede', label: 'Espessura das paredes', type: 'measure', hint: 'Meça no vão de uma porta.' },
          { id: 'esquadrias', label: 'Portas e janelas (observações)', type: 'textarea', placeholder: 'Medidas de vãos, peitoris, tipos…' },
        ],
      },
      {
        title: 'Cortes e fachadas',
        when: 'cortesFachadas',
        fields: [
          { id: 'alturaTotal', label: 'Altura total da edificação', type: 'measure' },
          { id: 'cobertura', label: 'Tipo de cobertura', type: 'select', options: ['Telhado aparente', 'Telhado com platibanda', 'Laje', 'Misto'] },
          { id: 'inclinacao', label: 'Inclinação do telhado (%)', type: 'number' },
          { id: 'peitoril', label: 'Altura padrão do peitoril', type: 'measure' },
          { id: 'verga', label: 'Altura padrão da verga', type: 'measure' },
          { id: 'fotoFachada', label: 'Foto da fachada principal', type: 'photo' },
        ],
      },
      {
        title: 'Pontos de instalação',
        when: 'instalacoes',
        fields: [
          { id: 'quadro', label: 'Local do quadro de distribuição', type: 'text' },
          { id: 'tomadas', label: 'Tomadas e interruptores (observações)', type: 'textarea' },
          { id: 'agua', label: 'Pontos de água', type: 'textarea' },
          { id: 'esgoto', label: 'Ralos, caixas e saídas de esgoto', type: 'textarea' },
          { id: 'caixaGordura', label: 'Tem caixa de gordura', type: 'check' },
          { id: 'fotoQuadro', label: 'Foto do quadro elétrico', type: 'photo' },
        ],
      },
      {
        title: 'Formato de entrega',
        fields: [
          { id: 'formato', label: 'Formato de entrega', type: 'multi', options: ['DWG (2D)', 'PDF', 'Modelo 3D (SketchUp)', 'Modelo 3D (Revit)'] },
          { id: 'prazo', label: 'Prazo combinado', type: 'date' },
        ],
      },
    ],
    problems: [
      { id: 'naoFecha', problem: 'As medidas do ambiente não fecham', solution: 'Meça as duas diagonais do ambiente. Se forem diferentes, as paredes estão fora de esquadro: registre as diagonais e desenhe por triangulação.' },
      { id: 'semAcesso', problem: 'Algum ambiente sem acesso no dia', solution: 'Anote quais ambientes faltaram, marque na planta como "não verificado" e agende o retorno antes da entrega.' },
      { id: 'desnivel', problem: 'Desníveis de piso entre ambientes', solution: 'Meça a altura de cada degrau/desnível e indique as cotas de nível na planta (ex.: +0,15).' },
      { id: 'semProjeto', problem: 'Não existe planta antiga ou projeto aprovado', solution: 'Faça o levantamento completo, incluindo as medidas externas do lote, para servir de base a uma futura regularização.' },
      { id: 'forro', problem: 'Forro rebaixado esconde o pé-direito real', solution: 'Meça até o forro e, se possível, acima dele pelo alçapão; registre as duas alturas.', when: 'cortesFachadas' },
    ],
    deliverables: [
      { id: 'dwg', label: 'Planta baixa com áreas por ambiente' },
      { id: 'cortes', label: 'Cortes e fachadas', when: 'cortesFachadas' },
      { id: 'inst', label: 'Planta de pontos de instalação', when: 'instalacoes' },
      { id: 'm3d', label: 'Modelo 3D do existente', when: 'modelo3d' },
    ],
  },

  {
    id: 'cortes',
    name: 'Cortes e fachadas',
    subtitle: 'Serviço avulso',
    description: 'Desenho dos cortes e/ou das fachadas de uma edificação existente.',
    mode: 'single',
    options: [
      { id: 'soCortes', label: 'Só cortes' },
      { id: 'soFachadas', label: 'Só fachadas' },
      { id: 'ambos', label: 'Cortes e fachadas' },
    ],
    sections: [
      IMOVEL,
      VISITA,
      {
        title: 'Cortes',
        when: ['soCortes', 'ambos'],
        fields: [
          { id: 'nCortes', label: 'Quantidade de cortes', type: 'number' },
          { id: 'peDireito', label: 'Pé-direito', type: 'measure' },
          { id: 'laje', label: 'Espessura da laje', type: 'measure' },
          { id: 'peitoril', label: 'Altura do peitoril', type: 'measure' },
          { id: 'verga', label: 'Altura da verga', type: 'measure' },
          { id: 'cumeeira', label: 'Altura da cumeeira', type: 'measure' },
          { id: 'inclinacao', label: 'Inclinação do telhado (%)', type: 'number' },
        ],
      },
      {
        title: 'Fachadas',
        when: ['soFachadas', 'ambos'],
        fields: [
          { id: 'nFachadas', label: 'Quantidade de fachadas', type: 'number' },
          { id: 'alturaTotal', label: 'Altura total', type: 'measure' },
          { id: 'revestimentos', label: 'Revestimentos e cores', type: 'textarea' },
          { id: 'fotoFrente', label: 'Foto da fachada frontal', type: 'photo' },
          { id: 'fotoLateral', label: 'Foto de outra fachada', type: 'photo' },
        ],
      },
    ],
    problems: [
      { id: 'telhado', problem: 'Telhado ou cumeeira inacessível', solution: 'Meça com a trena do chão até o beiral e calcule a cumeeira pela inclinação do telhado; confirme com fotos laterais.' },
      { id: 'obstaculo', problem: 'Fachada encoberta (árvore, muro, vizinho)', solution: 'Faça fotos em ângulo e medidas parciais; complete com a planta baixa e indique no desenho o trecho estimado.' },
      { id: 'semPlanta', problem: 'Não há planta baixa de base', solution: 'Os cortes dependem da planta: faça antes o levantamento cadastral (serviço "Levantamento cadastral").' },
    ],
    deliverables: [
      { id: 'cortes', label: 'Cortes', when: ['soCortes', 'ambos'] },
      { id: 'fachadas', label: 'Fachadas', when: ['soFachadas', 'ambos'] },
    ],
  },

  {
    id: 'render',
    name: 'Renderização 3D',
    subtitle: 'Imagens realistas',
    description: 'Imagens realistas do projeto para apresentação ao cliente.',
    mode: 'multi',
    options: [
      { id: 'interno', label: 'Ambientes internos' },
      { id: 'externo', label: 'Fachada / área externa' },
    ],
    sections: [
      {
        title: 'Briefing',
        fields: [
          { id: 'cliente', label: 'Cliente', type: 'text', bind: 'owner' },
          { id: 'base', label: 'Arquivo de base', type: 'select', options: ['DWG', 'SketchUp', 'Revit', 'Só fotos/croquis', 'Nenhum (modelar do zero)'] },
          { id: 'nImagens', label: 'Quantidade de imagens', type: 'number' },
          { id: 'vistas', label: 'Ambientes e vistas desejadas', type: 'textarea' },
          { id: 'estilo', label: 'Estilo', type: 'select', options: ['Contemporâneo', 'Moderno', 'Minimalista', 'Industrial', 'Clássico', 'Rústico'] },
          { id: 'luz', label: 'Iluminação', type: 'multi', options: ['Dia', 'Fim de tarde', 'Noite'] },
          { id: 'mobiliario', label: 'Incluir mobiliário e decoração', type: 'check' },
          { id: 'materiais', label: 'Materiais e acabamentos', type: 'textarea' },
          { id: 'referencia', label: 'Imagem de referência', type: 'photo' },
          { id: 'resolucao', label: 'Resolução', type: 'select', options: ['Full HD (1920 px)', '4K (3840 px)'] },
          { id: 'prazo', label: 'Prazo combinado', type: 'date' },
        ],
      },
    ],
    problems: [
      { id: 'semEstilo', problem: 'Cliente sem referência de estilo', solution: 'Mostre 3 ou 4 imagens de estilos diferentes e peça para escolher; registre a escolhida como imagem de referência.' },
      { id: 'baseIncompleta', problem: 'Projeto de base incompleto', solution: 'Liste o que falta (alturas, esquadrias, cobertura) e combine se você vai estimar ou o cliente vai enviar.' },
      { id: 'revisoes', problem: 'Muitas alterações depois das imagens prontas', solution: 'Combine antes o número de revisões incluídas e aprove uma prévia (imagem de baixa resolução) antes da final.' },
    ],
    deliverables: [
      { id: 'imagens', label: 'Imagens finais' },
      { id: 'previa', label: 'Prévia aprovada pelo cliente' },
    ],
  },

  {
    id: 'regularizacao',
    name: 'Regularização de imóveis',
    subtitle: 'Prefeitura, cartório e Receita',
    description: 'Levanta a situação do imóvel e indica o caminho para regularizar.',
    mode: 'multi',
    options: [
      { id: 'prefeitura', label: 'Regularização da edificação na prefeitura (obra sem alvará)' },
      { id: 'habitese', label: 'Habite-se' },
      { id: 'averbacao', label: 'Averbação da construção no cartório' },
      { id: 'receita', label: 'Regularização na Receita Federal (CNO e CND da obra)' },
      { id: 'retificacao', label: 'Retificação de área na matrícula' },
      { id: 'desmembramento', label: 'Desmembramento de lote' },
      { id: 'remembramento', label: 'Remembramento ou unificação de lotes' },
      { id: 'usucapiao', label: 'Usucapião' },
      { id: 'reurb', label: 'Regularização fundiária urbana (Reurb)' },
      { id: 'condominio', label: 'Aprovação de reforma no condomínio' },
    ],
    sections: [
      IMOVEL,
      {
        title: 'Situação atual',
        fields: [
          { id: 'temMatricula', label: 'Tem matrícula no cartório', type: 'check' },
          { id: 'temAlvara', label: 'Obra teve alvará / projeto aprovado', type: 'check' },
          { id: 'temHabitese', label: 'Tem habite-se', type: 'check' },
          { id: 'proprietarioVivo', label: 'Proprietário da matrícula está vivo', type: 'check' },
          { id: 'areaTerrenoMat', label: 'Área do terreno na matrícula', type: 'area' },
          { id: 'areaTerrenoReal', label: 'Área do terreno medida', type: 'area', bind: 'landArea' },
          { id: 'difTerreno', label: 'Diferença do terreno', type: 'calc', calc: diffArea('areaTerrenoMat', 'areaTerrenoReal', 'área da matrícula', 'Área medida') },
          { id: 'areaConstAverbada', label: 'Área construída averbada', type: 'area' },
          { id: 'areaConstReal', label: 'Área construída real', type: 'area' },
          { id: 'difConst', label: 'Área a regularizar', type: 'calc', calc: diffArea('areaConstAverbada', 'areaConstReal', 'área averbada', 'Área real') },
          { id: 'anoConclusao', label: 'Ano de conclusão da obra', type: 'number' },
        ],
      },
      {
        title: 'Parâmetros urbanísticos',
        when: ['prefeitura', 'habitese', 'desmembramento', 'remembramento'],
        fields: [
          { id: 'zona', label: 'Zona (lei de uso e ocupação)', type: 'text' },
          { id: 'recuoFrente', label: 'Recuo frontal existente', type: 'measure' },
          { id: 'recuoLateral', label: 'Menor recuo lateral', type: 'measure' },
          { id: 'recuoFundos', label: 'Recuo de fundos', type: 'measure' },
          { id: 'taxaOcupacao', label: 'Taxa de ocupação existente (%)', type: 'number' },
          { id: 'permeavel', label: 'Área permeável', type: 'area' },
          { id: 'atendeLei', label: 'Atende aos parâmetros da lei', type: 'check' },
        ],
      },
      {
        title: 'Prefeitura e habite-se',
        when: ['prefeitura', 'habitese'],
        fields: [
          { id: 'obraConcluida', label: 'Obra concluída', type: 'check' },
          { id: 'notificacao', label: 'Tem notificação ou multa da prefeitura', type: 'check' },
          { id: 'protocolo', label: 'Nº do processo na prefeitura', type: 'text' },
          { id: 'bombeiros', label: 'Precisa de vistoria dos bombeiros (AVCB)', type: 'check' },
          { id: 'ligacoes', label: 'Ligações definitivas de água e luz', type: 'check' },
        ],
      },
      {
        title: 'Receita Federal (CNO e CND)',
        when: ['receita', 'averbacao'],
        fields: [
          { id: 'cno', label: 'Obra já tem CNO', type: 'check' },
          { id: 'tipoObra', label: 'Destinação', type: 'select', options: ['Residencial unifamiliar', 'Residencial multifamiliar', 'Comercial', 'Galpão / industrial'] },
          { id: 'maoDeObra', label: 'Mão de obra', type: 'select', options: ['Própria (pessoa física)', 'Empreiteira com nota fiscal', 'Mista'] },
          { id: 'notas', label: 'Tem notas fiscais de material e serviço', type: 'check' },
        ],
      },
      {
        title: 'Retificação de área',
        when: 'retificacao',
        fields: [
          { id: 'confrontantes', label: 'Confrontantes (nome de cada vizinho)', type: 'textarea' },
          { id: 'anuencia', label: 'Confrontantes aceitam assinar', type: 'check' },
          { id: 'rural', label: 'Imóvel rural (exige georreferenciamento)', type: 'check' },
        ],
      },
      {
        title: 'Desmembramento / remembramento',
        when: ['desmembramento', 'remembramento'],
        fields: [
          { id: 'nLotes', label: 'Nº de lotes resultantes', type: 'number', when: 'desmembramento' },
          { id: 'nMatriculas', label: 'Nº de matrículas a unificar', type: 'number', when: 'remembramento' },
          { id: 'testadaMin', label: 'Menor testada resultante', type: 'measure' },
          { id: 'areaMinLei', label: 'Área mínima de lote pela lei', type: 'area' },
          { id: 'mesmoDono', label: 'Todos os lotes têm o mesmo proprietário', type: 'check', when: 'remembramento' },
        ],
      },
      {
        title: 'Usucapião',
        when: 'usucapiao',
        fields: [
          { id: 'modalidade', label: 'Modalidade', type: 'select', options: ['Extraordinária (15 anos, ou 10 se mora ou fez obras)', 'Ordinária (10 anos, com justo título)', 'Especial urbana (5 anos, até 250 m²)', 'Familiar (2 anos)'] },
          { id: 'anosPosse', label: 'Tempo de posse (anos)', type: 'number' },
          { id: 'via', label: 'Via', type: 'select', options: ['Extrajudicial (cartório)', 'Judicial'] },
          { id: 'provas', label: 'Provas de posse', type: 'multi', options: ['IPTU em nome do possuidor', 'Contas de água/luz', 'Contrato de compra (gaveta)', 'Testemunhas', 'Fotos antigas'] },
        ],
      },
      {
        title: 'Reurb',
        when: 'reurb',
        fields: [
          { id: 'modalidadeReurb', label: 'Modalidade', type: 'select', options: ['Reurb-S (interesse social)', 'Reurb-E (interesse específico)'] },
          { id: 'nucleo', label: 'Nome do núcleo / loteamento', type: 'text' },
          { id: 'nUnidades', label: 'Nº de unidades no núcleo', type: 'number' },
        ],
      },
      {
        title: 'Reforma no condomínio',
        when: 'condominio',
        fields: [
          { id: 'sindico', label: 'Síndico / administradora', type: 'text' },
          { id: 'estrutural', label: 'Mexe em estrutura, fachada ou instalações comuns', type: 'check' },
          { id: 'descricaoReforma', label: 'O que será reformado', type: 'textarea' },
          { id: 'regimento', label: 'Já tem o regimento interno', type: 'check' },
        ],
      },
    ],
    problems: [
      { id: 'areaMaior', problem: 'Área construída real maior que a averbada', solution: 'Caminho: projeto de regularização (as built) na prefeitura → habite-se → CND da obra na Receita → averbação da construção no cartório.', docs: ['Planta e memorial do existente', 'ART/RRT', 'Matrícula atualizada', 'IPTU'] },
      { id: 'terrenoDif', problem: 'Área do terreno medida diferente da matrícula', solution: 'Fazer a retificação de área direto no cartório (art. 213 da Lei 6.015/73), com planta, memorial descritivo, ART/RRT e assinatura dos confrontantes.', docs: ['Planta do terreno', 'Memorial descritivo', 'ART/RRT', 'Anuência dos confrontantes'] },
      { id: 'recuos', problem: 'Construção não respeita recuos ou taxa de ocupação', solution: 'Verificar se o município tem lei de regularização (anistia) em vigor; ela pode aceitar com pagamento de contrapartida ou exigir adequação.' },
      { id: 'falecido', problem: 'Proprietário da matrícula faleceu', solution: 'É preciso fazer o inventário e a partilha antes (ou junto) da regularização; o memorial descritivo serve para o inventário.' },
      { id: 'semMatricula', problem: 'Imóvel sem matrícula ou só com contrato de gaveta', solution: 'Avaliar usucapião (pode ser extrajudicial, no cartório) ou, se for um núcleo informal, Reurb.' },
      { id: 'semCnd', problem: 'Obra sem CNO / sem recolhimento de INSS', solution: 'Abrir o CNO, declarar a obra no SERO da Receita e emitir a CND. Obras concluídas há mais de 5 anos podem ter o INSS reduzido ou dispensado se houver prova da data (decadência).', docs: ['Habite-se ou prova da data de conclusão', 'Notas fiscais', 'Planta com área'] },
      { id: 'loteMinimo', problem: 'Lote resultante abaixo da área mínima da lei', solution: 'O desmembramento não é aprovado. Alternativa: instituir condomínio ou manter fração ideal na mesma matrícula.', when: 'desmembramento' },
      { id: 'donosDif', problem: 'Lotes a unificar com proprietários diferentes', solution: 'Primeiro igualar a titularidade (compra e venda ou doação entre eles); só depois o cartório faz a unificação.', when: 'remembramento' },
      { id: 'semPlanoReforma', problem: 'Reforma sem plano aprovado pelo condomínio', solution: 'Fazer o plano de reforma conforme a NBR 16.280, com ART/RRT, e protocolar com o síndico antes de começar a obra.', when: 'condominio' },
      { id: 'confrontanteRecusa', problem: 'Confrontante se recusa a assinar', solution: 'O cartório notifica o confrontante; se ele impugnar, o caso pode ir para via judicial.', when: ['retificacao', 'usucapiao'] },
    ],
    deliverables: [
      { id: 'asbuilt', label: 'Projeto de regularização (as built)', when: ['prefeitura', 'habitese'] },
      { id: 'art', label: 'ART/RRT' },
      { id: 'memorial', label: 'Memorial descritivo', when: ['retificacao', 'desmembramento', 'remembramento', 'usucapiao', 'averbacao'] },
      { id: 'cnd', label: 'CND da obra', when: ['receita', 'averbacao'] },
      { id: 'protocolo', label: 'Protocolo na prefeitura', when: ['prefeitura', 'habitese', 'desmembramento', 'remembramento'] },
      { id: 'cartorio', label: 'Protocolo no cartório', when: ['averbacao', 'retificacao', 'desmembramento', 'remembramento', 'usucapiao'] },
      { id: 'planoReforma', label: 'Plano de reforma (NBR 16.280)', when: 'condominio' },
    ],
  },

  {
    id: 'memorial',
    name: 'Memorial descritivo',
    subtitle: 'Texto pronto para cartório e prefeitura',
    description: 'Descrição do terreno e da construção. O app escreve o texto a partir da ficha.',
    mode: 'single',
    options: [
      { id: 'usucapiao', label: 'Usucapião' },
      { id: 'inventario', label: 'Inventário e partilha' },
      { id: 'desmembramento', label: 'Desmembramento e remembramento de lotes' },
      { id: 'retificacao', label: 'Retificação de área' },
      { id: 'averbacao', label: 'Averbação de construção' },
      { id: 'prefeitura', label: 'Regularização na prefeitura' },
      { id: 'compraVenda', label: 'Compra e venda e escritura' },
      { id: 'financiamento', label: 'Financiamento e avaliação bancária' },
      { id: 'condominio', label: 'Instituição de condomínio' },
    ],
    sections: [
      IMOVEL,
      {
        title: 'Localização',
        fields: [
          { id: 'lote', label: 'Lote', type: 'text' },
          { id: 'quadra', label: 'Quadra', type: 'text' },
          { id: 'loteamento', label: 'Loteamento / bairro', type: 'text' },
          { id: 'cidade', label: 'Cidade / UF', type: 'text' },
          { id: 'distEsquina', label: 'Distância até a esquina mais próxima', type: 'measure' },
          { id: 'esquina', label: 'Nome da rua da esquina', type: 'text' },
        ],
      },
      CONFRONTACOES,
      CONSTRUCAO,
      {
        title: 'Condomínio',
        when: 'condominio',
        fields: [
          { id: 'nUnidades', label: 'Nº de unidades autônomas', type: 'number' },
          { id: 'areaPrivativa', label: 'Área privativa por unidade (descrever)', type: 'textarea' },
          { id: 'areaComum', label: 'Área de uso comum', type: 'area' },
          { id: 'fracao', label: 'Fração ideal (NBR 12.721)', type: 'textarea' },
        ],
      },
      {
        title: 'Financiamento',
        when: 'financiamento',
        fields: [
          { id: 'banco', label: 'Banco', type: 'text' },
          { id: 'habiteseAverbado', label: 'Habite-se averbado na matrícula', type: 'check' },
          { id: 'matriculaRecente', label: 'Matrícula com menos de 30 dias', type: 'check' },
        ],
      },
    ],
    memorial: true,
    problems: [
      { id: 'naoBate', problem: 'Medidas do local não batem com a matrícula', solution: 'O memorial deve seguir o que existe no local; faça a retificação de área antes ou junto do processo.' },
      { id: 'confrontanteDesconhecido', problem: 'Não se sabe o nome de um confrontante', solution: 'Consulte a matrícula ou o cadastro do IPTU do lote vizinho na prefeitura ou no cartório.' },
      { id: 'semMarcos', problem: 'Divisas sem marcos visíveis', solution: 'Contrate levantamento topográfico para definir os vértices antes de descrever o perímetro.' },
      { id: 'construcaoSemAverbar', problem: 'Construção existe mas não está averbada', solution: 'Para financiamento e venda, o banco exige a averbação: siga o caminho habite-se → CND → averbação.', when: ['financiamento', 'compraVenda'] },
      { id: 'semFracao', problem: 'Frações ideais não calculadas', solution: 'Calcule as áreas e frações conforme a NBR 12.721 (quadros de áreas) antes de registrar a instituição.', when: 'condominio' },
    ],
    deliverables: [
      { id: 'texto', label: 'Memorial descritivo assinado' },
      { id: 'art', label: 'ART/RRT do memorial' },
      { id: 'planta', label: 'Planta de situação/locação' },
    ],
  },
];

// Texto do memorial descritivo montado a partir da ficha.
export function memorialText(v, finalidade, company = {}) {
  const t = (x) => (x == null || x === '' ? '___' : String(x));
  const m = (x) => (num(x) == null ? '___ m' : `${num(x).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`);
  const a = (x) => (num(x) == null ? '___ m²' : m2(num(x)));
  const p = [];
  p.push(`MEMORIAL DESCRITIVO${finalidade ? ` - ${finalidade.toUpperCase()}` : ''}`);
  p.push(
    `IMÓVEL: ${v.areaConstruida ? 'Terreno com edificação' : 'Terreno'} situado à ${t(v.endereco)}` +
      `${v.lote ? `, lote ${v.lote}` : ''}${v.quadra ? `, quadra ${v.quadra}` : ''}${v.loteamento ? `, ${v.loteamento}` : ''}` +
      `${v.cidade ? `, ${v.cidade}` : ''}, objeto da matrícula nº ${t(v.matricula)} do ${t(v.cartorio)}` +
      `${v.inscricao ? `, inscrição imobiliária nº ${v.inscricao}` : ''}, de propriedade de ${t(v.proprietario)}.`
  );
  if (v.distEsquina || v.esquina) p.push(`LOCALIZAÇÃO: distante ${m(v.distEsquina)} da esquina com a ${t(v.esquina)}.`);
  p.push(
    `TERRENO: medindo ${m(v.frente)} de frente para ${t(v.confFrente)}; ${m(v.ladoDireito)} do lado direito, de quem da rua olha o imóvel, ` +
      `confrontando com ${t(v.confDireito)}; ${m(v.ladoEsquerdo)} do lado esquerdo, confrontando com ${t(v.confEsquerdo)}; ` +
      `e ${m(v.fundos)} nos fundos, confrontando com ${t(v.confFundos)}, encerrando a área de ${a(v.areaTerreno)}.`
  );
  if (num(v.areaConstruida)) {
    const partes = [
      v.pavimentos ? `${v.pavimentos} pavimento${v.pavimentos > 1 ? 's' : ''}` : null,
      v.estrutura ? `estrutura em ${v.estrutura.toLowerCase()}` : null,
      v.cobertura ? `cobertura em ${v.cobertura.toLowerCase()}` : null,
      v.padrao ? `padrão de acabamento ${v.padrao.toLowerCase()}` : null,
      v.conservacao ? `estado de conservação ${v.conservacao.toLowerCase()}` : null,
      v.idade ? `idade aparente de ${v.idade} anos` : null,
    ].filter(Boolean);
    p.push(`CONSTRUÇÃO: edificação com área construída de ${a(v.areaConstruida)}${partes.length ? `, ${partes.join(', ')}` : ''}.`);
    if (v.__ambientes) p.push(`AMBIENTES: ${v.__ambientes}.`);
  }
  if (v.nUnidades) p.push(`CONDOMÍNIO: ${v.nUnidades} unidades autônomas${num(v.areaComum) ? `, com área de uso comum de ${a(v.areaComum)}` : ''}.${v.fracao ? ` Frações ideais: ${v.fracao}` : ''}`);
  p.push(`${t(v.cidade)}, ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}.`);
  p.push(`_______________________________\n${company.responsavel || 'Responsável técnico'} - ${company.registro || 'CAU/CREA nº ___'}`);
  return p.join('\n\n');
}

export const isOn = (when, selected) => !when || (Array.isArray(when) ? when.some((w) => selected.includes(w)) : selected.includes(when));
export { sim };
