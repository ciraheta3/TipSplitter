import { useState } from 'react';
import type { Distribution } from './calculation';
import type { CalculationParticipant } from './sharedCalculationData';
import {
  distributeTips,
  formatCents,
  parseTipInput,
  parseWeightInput,
  sumTipCents,
} from './calculation';

interface Employee {
  id: string;
  name: string;
  jobTitle: string;
  // Retain the prototype's stored shape; scale at the calculation boundary.
  weight: number;
}

interface RosterState {
  employees: Employee[];
  error: string | null;
}

function isEmployee(value: unknown): value is Employee {
  if (typeof value !== 'object' || value === null) return false;
  const employee = value as Record<string, unknown>;
  return typeof employee.id === 'string' && typeof employee.name === 'string'
    && typeof employee.jobTitle === 'string' && typeof employee.weight === 'number';
}

function loadRoster(storageKey: string): RosterState {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return { employees: [], error: null };
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.every(isEmployee)) {
      throw new Error('Invalid roster shape');
    }
    return { employees: parsed, error: null };
  } catch {
    // Do not overwrite unreadable stored data on mount.
    return { employees: [], error: 'Saved roster could not be read. Adding an employee will save a new roster.' };
  }
}

type Props = { storageKey: string; shared?: { participants: CalculationParticipant[]; restaurantName: string; unavailable: boolean; validationError?: string } };

export default function Calculator({ storageKey, shared }: Props) {
  const [cashTip, setCashTip] = useState('');
  const [creditTip, setCreditTip] = useState('');
  const [roundToDollar, setRoundToDollar] = useState(false);
  const [roster, setRoster] = useState<RosterState>(() => shared ? { employees: [], error: null } : loadRoster(storageKey));
  const [formError, setFormError] = useState<string | null>(null);
  const { employees } = roster;

  const displayEmployees = shared ? (shared.unavailable || shared.validationError ? [] : shared.participants) : employees.map(employee => ({ ...employee, weightText: String(employee.weight) }));
  const inputPrefix = shared ? 'shared-' : '';

  let totalTipCents: number | undefined;
  let calculation: Distribution | undefined;
  let calculationError: string | undefined;
  try {
    totalTipCents = sumTipCents(parseTipInput(cashTip, 'Cash tips'), parseTipInput(creditTip, 'Credit tips'));
    if (shared?.validationError) throw new Error(shared.validationError);
    if (!shared?.unavailable) calculation = distributeTips(totalTipCents, shared ? shared.participants : employees.map(employee => ({
      id: employee.id,
      weightUnits: parseWeightInput(String(employee.weight)),
    })), roundToDollar ? 'whole-dollar' : 'exact-cent');
  } catch (error) {
    calculationError = error instanceof Error ? error.message : 'Unable to calculate payouts.';
  }
  const payoutsById = new Map(calculation?.payouts.map(payout => [payout.id, payout.cents]));
  const money = (cents: number | undefined) => cents === undefined ? '—' : `$${formatCents(cents)}`;
  const isMathValid = calculation !== undefined && calculation.remainderCents >= 0;

  const updateEmployees = (next: Employee[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setRoster({ employees: next, error: null });
    } catch {
      setRoster({ employees: next, error: 'Roster could not be saved. Changes will be lost when this page closes.' });
    }
  };

  const handleAddEmployee = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const name = String(formData.get('name') ?? '').trim();
      const jobTitle = String(formData.get('jobTitle') ?? '').trim();
      const weightUnits = parseWeightInput(String(formData.get('weight') ?? ''));
      if (!name || !jobTitle) throw new Error('Name and job title are required.');
      // Stored weights remain numeric for compatibility with existing rosters.
      const weight = Number(formatCents(weightUnits));
      if (parseWeightInput(String(weight)) !== weightUnits) {
        throw new Error('Weight is too large to store accurately.');
      }
      updateEmployees([...employees, { id: crypto.randomUUID(), name, jobTitle, weight }]);
      setFormError(null);
      event.currentTarget.reset();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to add employee.');
    }
  };

  const handleRemoveEmployee = (id: string) => {
    updateEmployees(employees.filter(employee => employee.id !== id));
  };

  return (
    <div hidden={shared?.unavailable} className="min-h-screen bg-gray-50 text-gray-900 p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Verification Dashboard */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-4 border-b pb-4">
            <h1 className="text-2xl font-bold text-gray-800">Tip Calculator Dashboard</h1>
            <label className="flex items-center space-x-2 text-sm font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={roundToDollar}
                onChange={(e) => setRoundToDollar(e.target.checked)}
                className="w-4 h-4"
              />
              <span>Round down to whole dollar</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div role="group" aria-label="Total Tip" className="p-4 bg-gray-100 rounded-lg border border-gray-200">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total Tip</p>
              <p className="text-3xl break-all font-mono font-medium">{money(totalTipCents)}</p>
            </div>
            <div role="group" aria-label="Allocated Tips" className="p-4 bg-gray-100 rounded-lg border border-gray-200">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Allocated Tips</p>
              <p className="text-3xl break-all font-mono font-medium">{money(calculation?.allocatedCents)}</p>
            </div>
            <div role="group" aria-label="Unassigned Remainder" className={`p-4 rounded-lg border-2 transition-colors ${isMathValid ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
              <p className={`text-xs font-bold uppercase tracking-wider ${isMathValid ? 'text-green-700' : 'text-red-700'}`}>
                Unassigned Remainder
              </p>
              <p className={`text-3xl break-all font-mono font-bold ${isMathValid ? 'text-green-600' : 'text-red-600'}`}>
                {calculation ? `${calculation.remainderCents >= 0 ? '+' : '-'}$${formatCents(Math.abs(calculation.remainderCents))}` : '—'}
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-600 mt-4">Preview only. Remainder = collected tips − allocated tips. Positive means unassigned; negative means overpaid. Leftover handling is separate.</p>
          {calculation?.status === 'no-positive-weight' && (
            <p role="status" className="text-sm text-gray-700 mt-2">{shared ? 'Select a participant with positive weight to allocate tips.' : 'Add an employee with positive weight to allocate tips.'} The entire pool remains unassigned.</p>
          )}
          {calculationError && <p role="alert" className="text-sm text-red-700 mt-2">{calculationError} Payouts are unavailable until corrected.</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Inputs Section */}
          <div className="md:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h2 className="text-lg font-bold mb-4">Tip Pool</h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor={`${inputPrefix}cash-tips`} className="block text-sm font-semibold mb-1">Cash Tips ($)</label>
                  <input
                    id={`${inputPrefix}cash-tips`}
                    type="text"
                    inputMode="decimal"
                    value={cashTip}
                    onChange={(e) => setCashTip(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label htmlFor={`${inputPrefix}credit-tips`} className="block text-sm font-semibold mb-1">Credit Tips ($)</label>
                  <input
                    id={`${inputPrefix}credit-tips`}
                    type="text"
                    inputMode="decimal"
                    value={creditTip}
                    onChange={(e) => setCreditTip(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {!shared && <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h2 className="text-lg font-bold mb-4">Add Employee</h2>
              <form onSubmit={handleAddEmployee} className="space-y-4">
                <input aria-label="Employee name" name="name" type="text" placeholder="Name" required className="w-full border border-gray-300 rounded p-2 text-sm" />
                <input aria-label="Job title" name="jobTitle" type="text" placeholder="Job Title (e.g., Server)" required className="w-full border border-gray-300 rounded p-2 text-sm" />
                <input aria-label="Share weight" name="weight" type="number" min="0" step="0.01" placeholder="Share Weight (e.g., 100)" required className="w-full border border-gray-300 rounded p-2 text-sm" />
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors">
                  + Add to Roster
                </button>
                {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
              </form>
            </div>}
          </div>

          {/* Roster Section */}
          <div className="md:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex flex-wrap justify-between items-end gap-2 mb-4 border-b pb-2">
              <h2 className="text-lg font-bold">{shared ? 'Selected Participants' : 'Employee Roster'}</h2>
              <span className="text-sm text-gray-500 font-semibold">Total Shares: {calculation ? formatCents(calculation.totalWeightUnits).replace(/\.00$/, '') : '—'}</span>
            </div>

            <p className="text-sm text-gray-600 mb-3">{shared ? `Restaurant shared roster · ${shared.restaurantName}. Temporary preview only; no saved shift or payment.` : 'Browser-local roster. Saved only in this browser; not synchronized to Supabase. Use fictional data for DEV testing.'}</p>
            {!shared && roster.error && <p role="alert" className="text-sm text-red-700 mb-3">{roster.error}</p>}
            {displayEmployees.length === 0 ? (
              <p className="text-gray-400 text-center py-8">{shared ? (shared.validationError ? 'Correct the selected participants’ temporary share weights to preview payouts.' : 'No participants selected.') : 'No employees added. Roster is empty.'}</p>
            ) : (
              <div className="space-y-3">
                {displayEmployees.map(emp => (
                  <div key={emp.id} role="group" aria-label={`Employee ${emp.name}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-gray-50 border border-gray-100 rounded">
                    <div className="min-w-0 break-words">
                      <p className="font-bold">{emp.name} <span className="text-xs text-gray-500 font-normal bg-gray-200 px-2 py-1 rounded ml-2">{emp.jobTitle}</span></p>
                      <p className="text-sm text-gray-600 mt-1">{shared ? 'Share weight' : 'Weight'}: {emp.weightText}</p>
                    </div>
                    <div className="flex items-center justify-between shrink-0 space-x-4">
                      <p className="font-mono font-bold text-lg text-blue-700">
                        {money(payoutsById.get(emp.id))}
                      </p>
                      {!shared && <button
                        aria-label={`Remove ${emp.name}`}
                        onClick={() => handleRemoveEmployee(emp.id)}
                        className="text-red-500 hover:text-red-700 font-bold px-2 py-1"
                      >
                        ✕
                      </button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
