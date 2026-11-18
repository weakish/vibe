import type { Preview } from 'storybook'
import '../src/index.css'

import { withThemeByClassName } from '@storybook/addon-themes';

const preview: Preview = {
    parameters: {
        backgrounds: { disable: true },
        controls: {
            matchers: {
                color: /(background|color)$/i,
                date: /Date$/i,
            },
        },
    },
    decorators: [
        withThemeByClassName({
            themes: {
                light: 'bg-white',
                dark: 'dark bg-black',
            },
            defaultTheme: 'light',
        }),
    ]
}

export default preview
