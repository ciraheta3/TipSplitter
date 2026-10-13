// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const metric = (name: string) => within(screen.getByRole('group', { name }));
const employee = (name: string) => metric(`Employee ${name}`);

async function addEmployee(user: ReturnType<typeof userEvent.setup>, name: string, weight: string) {
  // Explicitly replace fields; user-event can retain its editing cache after native form.reset().
  await user.clear(screen.getByRole('textbox', { name: 'Employee name' }));
  await user.clear(screen.getByRole('textbox', { name: 'Job title' }));
  await user.clear(screen.getByRole('spinbutton', { name: 'Share weight' }));
  await user.type(screen.getByRole('textbox', { name: 'Employee name' }), name);
  await user.type(screen.getByRole('textbox', { name: 'Job title' }), 'Test Server');
  await user.type(screen.getByRole('spinbutton', { name: 'Share weight' }), weight);
  await user.click(screen.getByRole('button', { name: '+ Add to Roster' }));
}

beforeEach(() => {
  localStorage.clear();
  let nextId = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() =>
    `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('TipSplitter interface', () => {
  it('combines cash and credit, including blank fields as zero', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(metric('Total Tip').getByText('$0.00')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Cash Tips ($)' }), '12.34');
    expect(metric('Total Tip').getByText('$12.34')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Credit Tips ($)' }), '87.66');
    expect(metric('Total Tip').getByText('$100.00')).toBeVisible();
    await user.clear(screen.getByRole('textbox', { name: 'Cash Tips ($)' }));
    expect(metric('Total Tip').getByText('$87.66')).toBeVisible();
  });

  it('adds and removes employees with fractional and zero weights', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addEmployee(user, 'Test Avery', '12.5');
    await addEmployee(user, 'Test Blake', '0');
    expect(employee('Test Avery').getByText('Weight: 12.5')).toBeVisible();
    expect(employee('Test Blake').getByText('Weight: 0')).toBeVisible();
    expect(screen.getByText('Total Shares: 12.50')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Employee name' })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Remove Test Avery' }));
    expect(screen.queryByRole('group', { name: 'Employee Test Avery' })).not.toBeInTheDocument();
    expect(screen.getByText('Total Shares: 0')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove Test Blake' }));
    expect(screen.getByText('No employees added. Roster is empty.')).toBeVisible();
    expect(JSON.parse(localStorage.getItem('employees')!)).toEqual([]);
  });

  it('floors weighted cent payouts and toggles whole dollars without redistributing leftovers', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addEmployee(user, 'Test Avery', '100');
    await addEmployee(user, 'Test Blake', '50');
    await user.type(screen.getByRole('textbox', { name: 'Cash Tips ($)' }), '100');
    expect(screen.getByText('Total Shares: 150')).toBeVisible();
    const expectCentPayouts = () => {
      expect(employee('Test Avery').getByText('$66.66')).toBeVisible();
      expect(employee('Test Blake').getByText('$33.33')).toBeVisible();
      expect(metric('Allocated Tips').getByText('$99.99')).toBeVisible();
      expect(metric('Unassigned Remainder').getByText('+$0.01')).toBeVisible();
    };
    expectCentPayouts();
    const toggle = screen.getByRole('checkbox', { name: 'Round down to whole dollar' });
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(employee('Test Avery').getByText('$66.00')).toBeVisible();
    expect(employee('Test Blake').getByText('$33.00')).toBeVisible();
    expect(metric('Allocated Tips').getByText('$99.00')).toBeVisible();
    expect(metric('Unassigned Remainder').getByText('+$1.00')).toBeVisible();
    expect(metric('Total Tip').getByText('$100.00')).toBeVisible();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expectCentPayouts();
    await user.click(screen.getByRole('button', { name: 'Remove Test Blake' }));
    expect(employee('Test Avery').getByText('$100.00')).toBeVisible();
    expect(metric('Unassigned Remainder').getByText('+$0.00')).toBeVisible();
  });

  it.each([
    ['Cash Tips ($)', '-1'],
    ['Credit Tips ($)', 'abc'],
    ['Cash Tips ($)', '1.001'],
    ['Credit Tips ($)', 'Infinity'],
    ['Cash Tips ($)', '90071992547409.92'],
  ])('hides stale payouts for invalid %s input %s and recovers after correction', async (label, invalid) => {
    const user = userEvent.setup();
    render(<App />);
    await addEmployee(user, 'Test Avery', '100');
    const input = screen.getByRole('textbox', { name: label });
    await user.type(input, '10');
    expect(employee('Test Avery').getByText('$10.00')).toBeVisible();
    await user.clear(input);
    await user.type(input, invalid);
    expect(screen.getByRole('alert')).toHaveTextContent('Payouts are unavailable until corrected.');
    expect(metric('Total Tip').getByText('—')).toBeVisible();
    expect(metric('Allocated Tips').getByText('—')).toBeVisible();
    expect(metric('Unassigned Remainder').getByText('—')).toBeVisible();
    expect(employee('Test Avery').getByText('—')).toBeVisible();
    expect(employee('Test Avery').queryByText('$10.00')).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '25');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(employee('Test Avery').getByText('$25.00')).toBeVisible();
  });

  it('rejects whitespace-only employee names and clears the error on a valid add', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addEmployee(user, '   ', '100');
    expect(screen.getByRole('alert')).toHaveTextContent('Name and job title are required.');
    expect(localStorage.getItem('employees')).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Employee name' }), 'Test Avery');
    await user.click(screen.getByRole('button', { name: '+ Add to Roster' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(employee('Test Avery').getByText('Weight: 100')).toBeVisible();
  });

  it('persists roster edits across remounts while cash and credit drafts reset', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await addEmployee(user, 'Test Avery', '100');
    await addEmployee(user, 'Test Blake', '50');
    await user.click(screen.getByRole('button', { name: 'Remove Test Blake' }));
    expect(JSON.parse(localStorage.getItem('employees')!)).toEqual([
      expect.objectContaining({ name: 'Test Avery', jobTitle: 'Test Server', weight: 100 }),
    ]);
    await user.type(screen.getByRole('textbox', { name: 'Cash Tips ($)' }), '40');
    await user.type(screen.getByRole('textbox', { name: 'Credit Tips ($)' }), '60');
    expect(employee('Test Avery').getByText('$100.00')).toBeVisible();
    first.unmount();
    render(<App />);
    expect(employee('Test Avery').getByText('Weight: 100')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Remove Test Blake' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Cash Tips ($)' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Credit Tips ($)' })).toHaveValue('');
    expect(metric('Total Tip').getByText('$0.00')).toBeVisible();
    expect(employee('Test Avery').getByText('$0.00')).toBeVisible();
  });

  it.each(['empty', 'zero-weight'] as const)('leaves the full pool unassigned for an %s roster in both modes', async kind => {
    const user = userEvent.setup();
    render(<App />);
    if (kind === 'zero-weight') await addEmployee(user, 'Test Zero', '0');
    await user.type(screen.getByRole('textbox', { name: 'Cash Tips ($)' }), '100');
    for (const wholeDollar of [false, true]) {
      if (wholeDollar) await user.click(screen.getByRole('checkbox', { name: 'Round down to whole dollar' }));
      expect(metric('Total Tip').getByText('$100.00')).toBeVisible();
      expect(metric('Allocated Tips').getByText('$0.00')).toBeVisible();
      expect(metric('Unassigned Remainder').getByText('+$100.00')).toBeVisible();
      expect(screen.getByRole('status')).toHaveTextContent('The entire pool remains unassigned.');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      if (kind === 'zero-weight') expect(employee('Test Zero').getByText('$0.00')).toBeVisible();
    }
  });

  it('keeps a zero-weight employee at zero beside a positive-weight employee', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addEmployee(user, 'Test Zero', '0');
    await addEmployee(user, 'Test Avery', '100');
    await user.type(screen.getByRole('textbox', { name: 'Credit Tips ($)' }), '10.25');
    expect(employee('Test Zero').getByText('$0.00')).toBeVisible();
    expect(employee('Test Avery').getByText('$10.25')).toBeVisible();
    expect(metric('Unassigned Remainder').getByText('+$0.00')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reports unreadable saved data without overwriting it on mount', async () => {
    const user = userEvent.setup();
    localStorage.setItem('employees', '{broken');
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('Saved roster could not be read.');
    expect(localStorage.getItem('employees')).toBe('{broken');
    await addEmployee(user, 'Test Avery', '100');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('employees')!)).toEqual([
      expect.objectContaining({ name: 'Test Avery', weight: 100 }),
    ]);
  });

  it('reports an invalid stored weight and restores payouts after removing the row', async () => {
    const user = userEvent.setup();
    localStorage.setItem('employees', JSON.stringify([
      { id: 'synthetic-invalid', name: 'Test Invalid', jobTitle: 'Test Server', weight: -1 },
    ]));
    render(<App />);
    await user.type(screen.getByRole('textbox', { name: 'Cash Tips ($)' }), '100');
    expect(screen.getByRole('alert')).toHaveTextContent('Weight must be nonnegative');
    expect(employee('Test Invalid').getByText('—')).toBeVisible();
    expect(metric('Allocated Tips').getByText('—')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove Test Invalid' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(metric('Unassigned Remainder').getByText('+$100.00')).toBeVisible();
  });
});
