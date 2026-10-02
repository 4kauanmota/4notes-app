import { describe, expect, it } from 'vitest'
import { detectCode, guessLanguage, normalizeCode } from '~/lib/editor/code-detect'
import { fenceFromVsCodeMode, findLanguage, languageLabel } from '~/lib/editor/languages'

const samples: Record<string, string> = {
  javascript: `import { ref } from 'vue'
const count = ref(0)
function inc() {
  count.value++
  console.log(count.value)
}`,
  typescript: `export interface Note {
  id: string
  title: string
}
export function titleOf(note: Note): string {
  return note.title.trim()
}`,
  python: `def soma(a, b):
    return a + b

if __name__ == "__main__":
    print(soma(1, 2))`,
  gdscript: `extends CharacterBody2D

@export var speed := 200.0

func _physics_process(delta: float) -> void:
    velocity = Input.get_vector("left", "right", "up", "down") * speed
    move_and_slide()`,
  json: `{
  "name": "4notes",
  "version": "1.1.0"
}`,
  html: `<div class="card">
  <h1>Olá</h1>
  <p>Texto</p>
</div>`,
  css: `.card {
  padding: 12px;
  color: red;
}`,
  sql: `SELECT id, title
FROM notes
WHERE title LIKE '%godot%'
ORDER BY title;`,
  bash: `npm install
npm run dev
git status`,
  csharp: `using Godot;
public partial class Player : CharacterBody2D
{
    public override void _Ready() { GD.Print("oi"); }
}`,
  cpp: `#include <iostream>
int main() {
  std::cout << "oi";
}`,
  rust: `fn main() {
    let mut x = 1;
    println!("{}", x);
}`,
}

describe('detecção de código colado', () => {
  for (const [language, code] of Object.entries(samples)) {
    it(`reconhece ${language}`, () => {
      expect(detectCode(code)).toEqual({ language })
    })
  }

  it('código sem linguagem conhecida ainda vira bloco', () => {
    const code = 'x = foo(1, 2);\nif (x > 2) {\n  bar(x);\n}'
    expect(detectCode(code)).not.toBeNull()
  })

  it('texto comum, listas e uma linha só continuam sendo texto', () => {
    const negatives = [
      'Reunião amanhã às 10h (sala 3).\nLevar o notebook e os relatórios do mês passado para revisar.',
      '- comprar pão\n- comprar leite\n- pagar a conta de luz',
      '# Ideias\nUm jogo de plataforma com pulo duplo e fases curtas.',
      'const x = 1',
      'Olá, tudo bem?\nAbraço!',
      'Select the file from the menu and click open.\nThen choose where to save it on your computer.',
      '1. Abrir o Godot\n2. Criar a cena\n3. Salvar',
    ]
    for (const text of negatives) expect(detectCode(text), text).toBeNull()
  })

  it('TypeScript ganha de JavaScript quando há tipos', () => {
    expect(guessLanguage('const a: string = "x";\nconsole.log(a)')).toBe('typescript')
  })

  it('remove a indentação comum e linhas vazias das pontas', () => {
    expect(normalizeCode('\n    if (a) {\n      b()\n    }\n\n')).toBe('if (a) {\n  b()\n}')
  })
})

describe('linguagens dos blocos', () => {
  it('encontra pelo nome da cerca, inclusive GDScript', () => {
    expect(findLanguage('ts')?.name).toBe('TypeScript')
    expect(findLanguage('gdscript')?.name).toBe('GDScript')
    expect(findLanguage('py')?.name ?? findLanguage('python')?.name).toBe('Python')
    expect(languageLabel('')).toBe('Código')
    expect(languageLabel('minhalinguagem')).toBe('minhalinguagem')
  })

  it('traduz o modo do VS Code para o nome do bloco', () => {
    expect(fenceFromVsCodeMode('typescriptreact')).toBe('tsx')
    expect(fenceFromVsCodeMode('markdown')).toBeNull()
    expect(fenceFromVsCodeMode(undefined)).toBeUndefined()
  })
})
