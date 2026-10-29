/**
 * Categoria automática das Finanças (1.7.2): escolhe, entre as categorias que você já
 * tem, a que mais combina com um lançamento. Nunca cria uma categoria.
 *
 * Ordem (a primeira que achar vale):
 *  1. o que você já fez: um lançamento com a mesma descrição (o "Uber trip" de ontem);
 *  2. um estabelecimento ou termo conhecido com mais de uma palavra ("uber eats", "mercado
 *     livre"): mais específico que o resto;
 *  3. o que você já fez com a mesma primeira palavra ("uber" → a categoria das outras
 *     corridas);
 *  4. o nome de uma das suas categorias escrito na descrição ("Farmácia" em "farmácia
 *     do bairro");
 *  5. um estabelecimento ou termo conhecido de uma palavra ("ifood", "netflix", "posto");
 *  6. a categoria padrão (Configurações › Finanças), só para gastos.
 *
 * Os passos 2 e 5 usam um dicionário de "assuntos" (alimentação, mercado, transporte…):
 * cada assunto tem termos que o reconhecem e nomes de categoria que o representam
 * ("Alimentação", "Comida", "Food"…). O lançamento vai para a sua categoria com um desses
 * nomes; sem nenhuma, tenta um assunto mais geral (combustível → transporte, mercado →
 * alimentação). As categorias que já estão nas Finanças vêm antes das outras do app.
 *
 * Regras puras, sem Vue e sem disco (testadas em tests/finance-categorize.test.ts).
 */
import type { EntryKind, Expense } from './model'
import { descriptionKey } from './statement'

export interface CategoryCandidate {
  id: string
  name: string
  /** Já está nas Finanças (as outras são do app e entram nas Finanças se escolhidas). */
  member: boolean
}

export interface CategorizeInput {
  description: string
  kind: EntryKind
  /** Outras pistas: nome do estabelecimento, categoria dada pelo banco… */
  hints?: readonly (string | null | undefined)[]
}

export type SuggestionSource = 'history' | 'keyword' | 'name' | 'default'

export interface CategorySuggestion {
  id: string
  source: SuggestionSource
  /** O assunto reconhecido (quando veio do dicionário). */
  topic?: string
}

interface Topic {
  id: string
  kind: EntryKind | 'both'
  /** Nomes de categoria que representam o assunto. */
  names: string[]
  /** Termos que reconhecem o assunto (estabelecimentos, palavras, categorias dos bancos em inglês). */
  terms: string[]
  /** Assunto mais geral para quando você não tem uma categoria deste. */
  parent?: string
}

/**
 * O dicionário. Os termos são comparados por palavras inteiras, sem acentos e sem
 * maiúsculas; palavras comuns demais ("dia", "extra", "bar") ficam de fora para não
 * pegar o que não devem.
 */
export const TOPICS: readonly Topic[] = [
  {
    id: 'delivery',
    kind: 'expense',
    names: ['delivery', 'pedidos', 'ifood'],
    terms: ['ifood', 'ifd', 'rappi', 'uber eats', 'ubereats', 'aiqfome', '99food', '99 food', 'ze delivery', 'james delivery', 'delivery much'],
    parent: 'alimentacao',
  },
  {
    id: 'restaurante',
    kind: 'expense',
    names: ['restaurante', 'restaurantes', 'comer fora', 'bares e restaurantes', 'lanches', 'lanche', 'eating out'],
    terms: [
      'restaurante', 'restaurant', 'lanchonete', 'lanche', 'lanches', 'hamburgueria', 'churrascaria', 'pizzaria', 'pizza', 'sushi',
      'temakeria', 'cafeteria', 'padaria', 'panificadora', 'sorveteria', 'acai', 'boteco', 'choperia', 'pastelaria', 'almoco',
      'jantar', 'cafe da manha', 'mcdonalds', 'mc donalds', 'mcdonald s', 'burger king', 'burguer king', 'subway', 'habibs',
      'habib s', 'giraffas', 'outback', 'madero', 'spoleto', 'starbucks', 'kfc', 'popeyes', 'dominos', 'domino s', 'pizza hut',
      'bobs', 'bob s', 'china in box', 'coco bambu', 'jeronimo', 'cacau show', 'kopenhagen', 'eating out', 'fast food',
    ],
    parent: 'alimentacao',
  },
  {
    id: 'mercado',
    kind: 'expense',
    names: ['mercado', 'supermercado', 'supermercados', 'compras de mercado', 'feira', 'hortifruti', 'groceries', 'grocery', 'despensa'],
    terms: [
      'supermercado', 'supermercados', 'hipermercado', 'mercearia', 'hortifruti', 'sacolao', 'atacarejo', 'atacadao', 'assai',
      'carrefour', 'pao de acucar', 'gpa', 'sams club', 'makro', 'zaffari', 'angeloni', 'condor', 'savegnago', 'guanabara',
      'prezunic', 'verdemar', 'super nosso', 'supernosso', 'mart minas', 'villefort', 'apoio mineiro', 'bh supermercados',
      'epa supermercados', 'bretas', 'comper', 'fort atacadista', 'tenda atacado', 'st marche', 'oba hortifruti', 'dia supermercado',
      'groceries', 'supermarket',
    ],
    parent: 'alimentacao',
  },
  {
    id: 'alimentacao',
    kind: 'expense',
    names: ['alimentacao', 'comida', 'food', 'refeicao', 'refeicoes', 'comer', 'alimentos', 'food and drinks', 'comida e bebida'],
    terms: ['food', 'food and drinks', 'refeicao', 'comida', 'alimentacao'],
  },
  {
    id: 'combustivel',
    kind: 'expense',
    names: ['combustivel', 'gasolina', 'posto', 'postos', 'fuel', 'abastecimento'],
    terms: [
      'posto', 'auto posto', 'gasolina', 'etanol', 'diesel', 'combustivel', 'abastecimento', 'shell', 'ipiranga', 'petrobras',
      'br mania', 'raizen', 'gas station', 'gas stations', 'fuel',
    ],
    parent: 'transporte',
  },
  {
    id: 'transporte',
    kind: 'expense',
    names: ['transporte', 'transportes', 'mobilidade', 'locomocao', 'transport', 'transportation', 'carro', 'uber', 'corridas'],
    terms: [
      'uber', 'uber trip', '99app', '99 app', '99 pop', '99pop', '99 taxi', 'cabify', 'indrive', 'taxi', 'metro', 'onibus',
      'bilhete unico', 'sptrans', 'bhtrans', 'move metropolitano', 'cartao otimo', 'cartao bom', 'riocard', 'estacionamento', 'estapar',
      'zona azul', 'pedagio', 'sem parar', 'conectcar', 'veloe', 'move mais', 'taggy', 'transportation', 'taxi and ride hailing',
      'ride hailing', 'parking', 'tolls', 'public transportation',
    ],
  },
  {
    id: 'farmacia',
    kind: 'expense',
    names: ['farmacia', 'remedios', 'medicamentos', 'drogaria', 'pharmacy'],
    terms: [
      'farmacia', 'drogaria', 'drogasil', 'droga raia', 'drogaraia', 'raia', 'pague menos', 'panvel', 'drogaria araujo', 'ultrafarma',
      'drogarias pacheco', 'drogaria sao paulo', 'venancio', 'remedio', 'remedios', 'pharmacy', 'drugstore',
    ],
    parent: 'saude',
  },
  {
    id: 'academia',
    kind: 'expense',
    names: ['academia', 'esportes', 'esporte', 'fitness', 'treino', 'gym'],
    terms: ['academia', 'smart fit', 'smartfit', 'bluefit', 'bio ritmo', 'selfit', 'gympass', 'wellhub', 'totalpass', 'crossfit', 'gym', 'sports'],
    parent: 'saude',
  },
  {
    id: 'saude',
    kind: 'expense',
    names: ['saude', 'health', 'medico', 'medicos', 'plano de saude', 'bem estar', 'bem-estar'],
    terms: [
      'unimed', 'amil', 'hapvida', 'notredame', 'sulamerica saude', 'bradesco saude', 'laboratorio', 'hermes pardini', 'fleury', 'dasa',
      'clinica', 'consulta', 'dentista', 'odonto', 'odontologia', 'hospital', 'exame', 'exames', 'health', 'healthcare', 'medical',
    ],
  },
  {
    id: 'contas',
    kind: 'expense',
    names: ['contas', 'contas de casa', 'contas fixas', 'contas da casa', 'utilidades', 'utilities', 'servicos', 'luz', 'energia', 'agua', 'internet', 'telefone', 'celular'],
    terms: [
      'cemig', 'enel', 'copel', 'celesc', 'coelba', 'cpfl', 'energisa', 'equatorial', 'neoenergia', 'conta de luz', 'energia eletrica',
      'sabesp', 'copasa', 'cedae', 'sanepar', 'embasa', 'compesa', 'conta de agua', 'comgas', 'vivo', 'claro', 'tim', 'algar',
      'brisanet', 'sky', 'conta de internet', 'internet', 'telefone', 'electricity', 'water', 'telecommunications', 'telecom', 'utilities',
    ],
    parent: 'moradia',
  },
  {
    id: 'moradia',
    kind: 'expense',
    names: ['moradia', 'casa', 'lar', 'aluguel', 'housing', 'home', 'condominio', 'apartamento'],
    terms: ['aluguel', 'condominio', 'iptu', 'quinto andar', 'quintoandar', 'imobiliaria', 'leroy merlin', 'telhanorte', 'housing', 'rent', 'home improvement'],
  },
  {
    id: 'assinaturas',
    kind: 'expense',
    names: ['assinaturas', 'assinatura', 'streaming', 'subscriptions', 'servicos digitais', 'apps'],
    terms: [
      'netflix', 'spotify', 'amazon prime', 'prime video', 'primevideo', 'disney plus', 'disneyplus', 'disney', 'hbo', 'hbo max',
      'globoplay', 'youtube premium', 'youtubepremium', 'deezer', 'apple com bill', 'icloud', 'google one', 'google storage',
      'xbox game pass', 'game pass', 'playstation plus', 'ps plus', 'chatgpt', 'openai', 'anthropic', 'claude ai', 'adobe', 'canva',
      'notion', 'github', 'crunchyroll', 'paramount', 'star plus', 'twitch', 'patreon', 'duolingo', 'microsoft 365', 'office 365',
      'dropbox', 'video streaming', 'music streaming', 'subscription',
    ],
    parent: 'lazer',
  },
  {
    id: 'viagem',
    kind: 'expense',
    names: ['viagem', 'viagens', 'travel', 'turismo', 'ferias', 'hospedagem'],
    terms: [
      'latam', 'gol linhas', 'voegol', 'azul linhas', 'voeazul', 'decolar', 'booking', 'airbnb', 'hotel', 'hoteis', 'pousada',
      '123milhas', 'maxmilhas', 'smiles', 'cvc', 'hurb', 'clickbus', 'buser', 'rodoviaria', 'passagem aerea', 'passagens aereas', 'travel',
      'airport and airlines', 'airlines', 'accommodation', 'lodging',
    ],
    parent: 'lazer',
  },
  {
    id: 'lazer',
    kind: 'expense',
    names: ['lazer', 'entretenimento', 'diversao', 'entertainment', 'cultura', 'hobbies', 'hobby', 'jogos', 'games', 'cinema', 'role', 'rolê'],
    terms: [
      'cinema', 'cinemark', 'kinoplex', 'cinepolis', 'ingresso', 'ingressos', 'ingresso com', 'sympla', 'eventim', 'ticketmaster',
      'teatro', 'show', 'parque', 'steam', 'steampowered', 'nuuvem', 'playstation', 'nintendo', 'epic games', 'riot games', 'blizzard',
      'entertainment', 'leisure', 'games',
    ],
  },
  {
    id: 'compras',
    kind: 'expense',
    names: ['compras', 'shopping', 'compras online', 'roupas', 'vestuario', 'eletronicos', 'compras gerais'],
    terms: [
      'mercado livre', 'mercadolivre', 'mercadolibre', 'amazon', 'amazon br', 'amazon marketplace', 'shopee', 'aliexpress', 'shein',
      'temu', 'magalu', 'magazine luiza', 'americanas', 'casas bahia', 'submarino', 'kabum', 'renner', 'riachuelo', 'c a modas', 'zara',
      'centauro', 'netshoes', 'decathlon', 'dafiti', 'nike', 'adidas', 'fast shop', 'ponto frio', 'shopping', 'online shopping',
      'clothing', 'electronics',
    ],
  },
  {
    id: 'educacao',
    kind: 'expense',
    names: ['educacao', 'estudos', 'estudo', 'cursos', 'curso', 'education', 'faculdade', 'escola', 'livros'],
    terms: [
      'udemy', 'alura', 'coursera', 'rocketseat', 'domestika', 'faculdade', 'universidade', 'escola', 'colegio', 'mensalidade escolar',
      'curso', 'cursos', 'livraria', 'livraria cultura', 'saraiva', 'kindle', 'education', 'books', 'bookstore',
    ],
  },
  {
    id: 'pets',
    kind: 'expense',
    names: ['pets', 'pet', 'animais', 'cachorro', 'gato', 'cachorros', 'gatos'],
    terms: ['petz', 'cobasi', 'petlove', 'pet shop', 'petshop', 'veterinario', 'veterinaria', 'clinica veterinaria', 'racao', 'pet supplies', 'vet'],
  },
  {
    id: 'beleza',
    kind: 'expense',
    names: ['beleza', 'cuidados pessoais', 'estetica', 'salao', 'higiene', 'autocuidado'],
    terms: ['salao', 'salao de beleza', 'barbearia', 'barber', 'barbershop', 'boticario', 'o boticario', 'natura', 'sephora', 'avon', 'eudora', 'manicure', 'personal care'],
  },
  {
    id: 'taxas',
    kind: 'expense',
    names: ['taxas', 'tarifas', 'impostos', 'tributos', 'encargos', 'bancos', 'banco', 'juros', 'fees', 'taxes'],
    terms: ['iof', 'tarifa', 'tarifas', 'anuidade', 'juros', 'multa', 'darf', 'ipva', 'licenciamento', 'detran', 'imposto', 'bank fees', 'taxes', 'tax', 'interests charged'],
  },
  {
    id: 'presentes',
    kind: 'expense',
    names: ['presentes', 'presente', 'doacoes', 'doacao', 'gifts', 'donations'],
    terms: ['presente', 'presentes', 'vakinha', 'doacao', 'gifts', 'donations'],
  },
  {
    id: 'salario',
    kind: 'income',
    names: ['salario', 'renda', 'receita', 'receitas', 'entradas', 'trabalho', 'income', 'salary'],
    terms: ['salario', 'folha', 'folha de pagamento', 'proventos', 'pro labore', 'prolabore', 'holerite', 'adiantamento salarial', 'salary', 'wages', 'payroll'],
  },
  {
    id: 'investimentos',
    kind: 'both',
    names: ['investimentos', 'investimento', 'poupanca', 'reserva', 'reserva de emergencia', 'investments'],
    terms: ['aplicacao', 'resgate', 'cdb', 'lci', 'lca', 'tesouro direto', 'tesouro', 'xp investimentos', 'nuinvest', 'btg pactual', 'corretora', 'poupanca', 'investments', 'investment'],
  },
]

const TOPIC_BY_ID = new Map(TOPICS.map((topic) => [topic.id, topic]))

/** Texto para comparar: sem acentos, minúsculo, só letras/números, entre espaços (para achar palavras inteiras). */
function wordsOf(text: string): string {
  const plain = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return ` ${plain} `
}

const singular = (word: string) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)

/** Nome de categoria comparável (sem acentos, emojis e plural simples). */
function nameKey(name: string): string {
  return wordsOf(name).trim().split(' ').map(singular).join(' ')
}

interface TermMatch {
  topic: Topic
  /** Quantas palavras o termo tem (mais palavras = mais específico). */
  words: number
  length: number
}

/** O assunto do texto: o termo mais específico (mais palavras, depois mais comprido) que aparece nele. */
export function topicOf(text: string, kind: EntryKind): TermMatch | null {
  const haystack = wordsOf(text)
  let best: TermMatch | null = null
  for (const topic of TOPICS) {
    if (topic.kind !== 'both' && topic.kind !== kind) continue
    for (const term of topic.terms) {
      const needle = wordsOf(term)
      if (needle.length <= 2 || !haystack.includes(needle)) continue
      const words = needle.trim().split(' ').length
      const length = needle.length
      if (!best || words > best.words || (words === best.words && length > best.length)) best = { topic, words, length }
    }
  }
  return best
}

/** A sua categoria que representa um assunto (ou um mais geral); as das Finanças antes das outras. */
export function categoryForTopic(topicId: string, candidates: readonly CategoryCandidate[]): CategoryCandidate | null {
  const keyed = candidates.map((candidate) => ({ candidate, key: nameKey(candidate.name) }))
  let topic = TOPIC_BY_ID.get(topicId)
  const seen = new Set<string>()
  while (topic && !seen.has(topic.id)) {
    seen.add(topic.id)
    const names = topic.names.map(nameKey)
    let best: { candidate: CategoryCandidate; score: number } | null = null
    for (const { candidate, key } of keyed) {
      let score = 0
      if (names.includes(key)) score = 3
      else if (names.some((name) => ` ${key} `.includes(` ${name} `))) score = 2
      if (!score) continue
      if (candidate.member) score += 10
      if (!best || score > best.score) best = { candidate, score }
    }
    if (best) return best.candidate
    topic = topic.parent ? TOPIC_BY_ID.get(topic.parent) : undefined
  }
  return null
}

export interface CategorizerOptions {
  /** A categoria padrão das Finanças (Configurações), para gastos sem outra sugestão. */
  defaultCategory?: string | null
}

/**
 * Monta o "categorizador" a partir dos lançamentos já classificados e das categorias que
 * você tem. Devolve a categoria sugerida (ou null) para cada lançamento novo.
 */
export function createCategorizer(
  entries: readonly Expense[],
  candidates: readonly CategoryCandidate[],
  options: CategorizerOptions = {},
): (input: CategorizeInput) => CategorySuggestion | null {
  const members = candidates.filter((candidate) => candidate.member)
  const known = new Set(candidates.map((candidate) => candidate.id))
  // O que você já fez: votos por descrição e pela primeira palavra (como o sugeridor da
  // importação de extrato, statement.ts › categorySuggester), com o dicionário entre eles.
  const byDescription = new Map<string, Map<string, number>>()
  const byFirstWord = new Map<string, Map<string, number>>()
  const vote = (map: Map<string, Map<string, number>>, key: string, id: string) => {
    if (!key) return
    const votes = map.get(key) ?? new Map<string, number>()
    votes.set(id, (votes.get(id) ?? 0) + 1)
    map.set(key, votes)
  }
  const memberIds = new Set(members.map((candidate) => candidate.id))
  for (const entry of entries) {
    if (!entry.categoryId || !memberIds.has(entry.categoryId) || entry.status === 'cancelled') continue
    const key = descriptionKey(entry.description)
    vote(byDescription, `${entry.kind}|${key}`, entry.categoryId)
    const word = key.split(' ').find((part) => part.length >= 3)
    if (word) vote(byFirstWord, `${entry.kind}|${word}`, entry.categoryId)
  }
  const winner = (votes: Map<string, number> | undefined) => (votes?.size ? [...votes.entries()].sort((a, b) => b[1] - a[1])[0]![0] : null)
  const names = candidates
    .map((candidate) => ({ candidate, key: nameKey(candidate.name) }))
    .filter((item) => item.key.replace(/\s/g, '').length >= 3)
    // As das Finanças antes; nomes mais compridos antes ("Contas de casa" antes de "Casa")
    .sort((a, b) => Number(b.candidate.member) - Number(a.candidate.member) || b.key.length - a.key.length)

  const fallback = options.defaultCategory && known.has(options.defaultCategory) ? options.defaultCategory : null

  return (input) => {
    const text = [input.description, ...(input.hints ?? [])].filter(Boolean).join(' ')
    const key = descriptionKey(input.description)
    const exact = key ? winner(byDescription.get(`${input.kind}|${key}`)) : null
    if (exact) return { id: exact, source: 'history' }

    const term = topicOf(text, input.kind)
    const fromTopic = term ? categoryForTopic(term.topic.id, candidates) : null
    if (term && fromTopic && term.words > 1) return { id: fromTopic.id, source: 'keyword', topic: term.topic.id }

    const word = key.split(' ').find((part) => part.length >= 3)
    const sameStart = word ? winner(byFirstWord.get(`${input.kind}|${word}`)) : null
    if (sameStart) return { id: sameStart, source: 'history' }

    const words = ` ${nameKey(text)} `
    const named = names.find((item) => words.includes(` ${item.key} `))
    if (named) return { id: named.candidate.id, source: 'name' }

    if (term && fromTopic) return { id: fromTopic.id, source: 'keyword', topic: term.topic.id }
    if (fallback && input.kind === 'expense') return { id: fallback, source: 'default' }
    return null
  }
}
