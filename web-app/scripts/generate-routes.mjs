/**
 * Pre-build route generation script.
 *
 * Runs the TanStack Router file-based route generator before tsc + vite build.
 * This ensures the routeTree.gen.ts is up-to-date before TypeScript compilation.
 *
 * The TanStackRouterVite plugin also regenerates during `vite build`, but running
 * this first ensures tsc -b sees a fresh tree.
 */
import { Generator, getConfig } from '@tanstack/router-generator'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const config = await getConfig({
  configDirectory: root,
  config: {
    target: 'react',
    autoCodeSplitting: true,
    routesDirectory: './src/routes',
    generatedRouteTree: './src/routeTree.gen.ts',
    routeFileIgnorePattern: '.((test).ts)|test-page',
    routeFileIgnorePrefix: '-',
    disableLogging: false,
  },
})

const generator = new Generator({ config })
await generator.run()
