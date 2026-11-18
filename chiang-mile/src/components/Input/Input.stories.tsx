import type { Meta, StoryObj } from '@storybook/react'
import { Input } from './Input'

const meta: Meta<typeof Input> = {
    title: 'Components/Input',
    component: Input,
    tags: ['autodocs'],
    argTypes: {
        type: {
            control: 'select',
            options: ['text', 'email', 'password', 'number'],
        },
        disabled: {
            control: 'boolean',
        },
    },
}

export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = {
    args: {
        label: 'Email',
        placeholder: 'Enter your email',
        type: 'email',
    },
}

export const WithHelperText: Story = {
    args: {
        label: 'Username',
        placeholder: 'Choose a username',
        helperText: 'This will be your public display name',
    },
}

export const WithError: Story = {
    args: {
        label: 'Email',
        placeholder: 'Enter your email',
        value: 'invalid-email',
        error: 'Please enter a valid email address',
    },
}

export const Disabled: Story = {
    args: {
        label: 'Disabled Input',
        placeholder: 'This input is disabled',
        disabled: true,
    },
}

export const Password: Story = {
    args: {
        label: 'Password',
        placeholder: 'Enter your password',
        type: 'password',
        helperText: 'Must be at least 8 characters',
    },
}

export const WithoutLabel: Story = {
    args: {
        placeholder: 'Search...',
    },
}

export const AllStates: Story = {
    render: () => (
        <div className="flex flex-col gap-6 max-w-sm">
            <Input label="Default" placeholder="Enter text" />
            <Input label="With Value" value="Hello World" />
            <Input label="With Helper" placeholder="Enter text" helperText="This is helper text" />
            <Input label="With Error" value="invalid" error="This field has an error" />
            <Input label="Disabled" placeholder="Disabled input" disabled />
        </div>
    ),
}
