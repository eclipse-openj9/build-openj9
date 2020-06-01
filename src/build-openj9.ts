import * as core from '@actions/core'
import * as builder from './builder'

async function run(): Promise<void> {
  try {
    const version = core.getInput('version', {required: false})
    const repository = core.getInput('repository', {required: false})
    const ref = core.getInput('ref', {required: false})
    const usePersonalRepo = core.getInput('usePersonalRepo') === 'true'
    if (repository.length === 0 && ref.length !== 0) {
      core.error(`Please give repository name`)
    }
    await builder.buildJDK(version, usePersonalRepo)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
