import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

export default defineConfig({
    plugins: [pluginReact()],
    source: {
        entry: {
            index: './src/main.tsx',
        },
    },
    performance: {
        buildCache: {
            cacheDirectory: '/tmp/cache/.rsbuild-app',
        },
    },
    dev: {
        lazyCompilation: true,
    },
    html: {
        template: './index.html',
        inject: false,
        title: '',
    },
    server: {
        proxy: {
            '/api': 'http://localhost:4000',
        },
    },
})
