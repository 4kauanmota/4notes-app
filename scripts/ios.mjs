// npm run build:ios — o 4notes para iPhone/iPad (ainda não incluído).
//
// O Capacitor gera o app iOS a partir da MESMA interface, mas:
//  1. o build do iOS só roda num Mac, com o Xcode (exigência da Apple);
//  2. o iOS não tem "Acesso a todos os arquivos": um app só grava na própria pasta
//     (Arquivos › No meu iPhone › 4notes) ou em pastas escolhidas pelo app Arquivos.
//     A camada de plataforma (app/lib/mobile) precisaria de um modo para isso, e a
//     sincronização seria pelo iCloud Drive / app Arquivos.
// Este comando só explica os passos — nada é alterado.
const lines = [
  '',
  'iOS: ainda não incluído no 4notes.',
  '',
  'O mesmo código serve para iOS (Capacitor), mas o build exige um Mac com o Xcode, e o iOS',
  'não permite o workspace numa pasta qualquer (só na pasta do app ou via app Arquivos):',
  'a camada de plataforma do celular (app/lib/mobile) precisaria de um modo para isso.',
  '',
  'Quando quiser o iOS, num Mac:',
  '  npm install -D @capacitor/ios',
  '  npx cap add ios',
  '  npm run build:web && npx cap sync ios',
  '  npx cap open ios        (o Xcode gera e instala o app)',
  '',
]
console.log(lines.join('\n'))
if (process.platform !== 'darwin') console.log('Este computador não é um Mac: o build do iOS não é possível aqui.\n')
