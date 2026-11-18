import { StorybookConfig } from 'storybook-react-rsbuild'
import { mergeRsbuildConfig } from '@rsbuild/core'
import path from 'path'

const config: StorybookConfig = {
    stories: [
        '../src/components/!(Button|Input)/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    ],
    framework: 'storybook-react-rsbuild',
    core: {
        disableTelemetry: true,
    },
    addons: ['@storybook/addon-themes'],
    async rsbuildFinal(config) {
        return mergeRsbuildConfig(config, {
            performance: {
                buildCache: {
                    cacheDirectory: '/tmp/cache/.rsbuild-storybook',
                },
            },
            resolve: {
                alias: {
                    react: path.resolve('node_modules/react'),
                },
            },
        })
    }
}

export default config
