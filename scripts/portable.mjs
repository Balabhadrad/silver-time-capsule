import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

if (!existsSync('dist')) {
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })
}
mkdirSync('portable', { recursive: true })
copyFileSync('README.md', 'dist/README.md')
execFileSync('zip', ['-r', '../portable/time-capsule-silver-dist.zip', '.'], { cwd: 'dist', stdio: 'inherit' })
console.log('portable/time-capsule-silver-dist.zip')
