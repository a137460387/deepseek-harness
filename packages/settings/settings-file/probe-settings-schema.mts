import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
import { Config } from '../../llm/llm-pi-ai/src/config.ts'

for (const f of ['settings.yaml.bak-wb2a-sync', 'settings.yaml.bak-pre-restore-2048', 'settings.yaml.bak-efforts2']) {
  const doc = parseDocument(readFileSync(`C:/Users/luoguangyu/.dsh/${f}`, 'utf8')).toJS() as Record<string, unknown>
  try {
    Config(doc['llm-pi-ai'] as never)
    console.log(`${f}: OK`)
  } catch (error) {
    console.log(`${f}: FAILED -> ${(error as Error).message.split('\n')[0]}`)
  }
}
