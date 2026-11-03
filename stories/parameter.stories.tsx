import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { getOperatorDefinition, getParameter } from '../src/graph';
import { ParameterControl } from '../src/components/ParameterControl';

const gain = getParameter(getOperatorDefinition('audio.gain'), 'db')!;
const meta = { title: 'Controls/Parameter', component: ParameterControl, parameters: { docs: { description: { component: 'The same registry-driven control is used in nodes, Inspector and Performance. A connected wire retains the saved literal.' } } }, args: { nodeId: 'gain', parameter: gain, value: -18, onChange: () => undefined } } satisfies Meta<typeof ParameterControl>;
export default meta;
type Story = StoryObj<typeof meta>;

function NumericFixture() { const [value, setValue] = useState<number | string | boolean>(-18); return <div style={{ width: 280 }}><ParameterControl nodeId="gain" parameter={gain} value={value} onChange={setValue} onPin={() => undefined} /></div>; }
export const Numeric: Story = { render: () => <NumericFixture /> };
export const Wired: Story = { args: { wired: true, liveValue: -12 }, render: (args) => <div style={{ width: 280 }}><ParameterControl {...args} /></div> };
