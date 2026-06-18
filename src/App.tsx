import { useState, useEffect } from 'react';

// --- TYPES ---
interface Employee {
  id: string;
  name: string;
  jobTitle: string;
  weight: number;
}

export default function App() {
  // --- STATE ---
  const [cashTip, setCashTip] = useState<number | ''>('');
  const [creditTip, setCreditTip] = useState<number | ''>('');
  const [roundToDollar, setRoundToDollar] = useState<boolean>(false);

  // --- TODO: LOCAL STORAGE PERSISTENCE ---
  // 1. Write a useEffect to load 'employees' from localStorage on initial mount.
  const [employees, setEmployees] = useState<Employee[]>(() => {
    try {
      const saved = localStorage.getItem('employees');
      if (!saved) return [];

      // 1. Attempt to parse the string
      const parsed = JSON.parse(saved);

      // 2. RUNTIME TYPE GATE: Verifiy it is an array
      if (Array.isArray(parsed)) {
        return parsed as Employee[];
      }

      // If it's valid JSON but NOT an array, log an warning and fall back
      console.warn("Local storage data found, but it is not a valid array.");
      return [];

    } catch (error) {
      // 3. Catch structural JSON syntax errors gracefully
      console.error("Failed to parse local storage 'employees' key safely:", error);
      return [];
    }
  });
  // 2. Write a useEffect to save 'employees' to localStorage whenever the array mutates.
  useEffect(() => {
    localStorage.setItem('employees', JSON.stringify(employees));
  }, [employees]);

  // --- Socratic TDD: CORE MATH & LOGIC ---
  // Do NOT edit the UI below until these calculations are strictly correct.

  // TODO 1: Total Tip calculation
  // Constraint: Treat empty strings ('') as 0. 
  const totalTip = (cashTip || 0) + (creditTip || 0);

  // TODO 2: Total Shares calculation
  // Formula: $TotalShares = \sum EmployeeWeights$
  const totalShares: number = employees.reduce((acc, emp) => acc + emp.weight, 0);

  // TODO 3: Value Per Share calculation
  // Constraint: Prevent division by zero if totalShares is 0.
  
  const valuePerShare: number = totalShares > 0 ? totalTip / totalShares : 0; 

  // TODO 4: Calculate Individual Employee Tips
  // Constraint: Apply the rounding rule based on the `roundToDollar` boolean state.
  // If false, round to 2 decimal places. If true, round to the nearest whole dollar.
  const getEmployeeCalculatedTip = (weight: number): number => {
    const rawTip = valuePerShare * weight;
    return roundToDollar ? Math.round(rawTip) : Number(rawTip.toFixed(2)); 
  };

  // TODO 5: Sum of Paid Tips
  // Constraint: This must be the sum of the INDIVIDUAL ROUNDED tips, not the raw fraction.
  const sumOfPaidTips: number = employees.reduce((acc, emp) => acc + getEmployeeCalculatedTip(emp.weight), 0); 

  // TODO 6: Variance Calculation
  // Formula: Total Tip minus Sum of Paid Tips.
  const variance: number = totalTip - sumOfPaidTips; 

  // --- STATE MUTATION HANDLERS ---
  
  // TODO 7: Add Employee Logic
  const handleAddEmployee = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // 1. Extract values from form target.
    // 2. Validate weight is >= 0.
    // 3. Append to employees array with a unique ID (e.g., crypto.randomUUID()).
    // 4. Reset form inputs.
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const jobTitle = formData.get('jobTitle') as string;
    const weightRaw = formData.get('weight') as string;
    const weight = parseFloat(weightRaw);

    console.log("DEBUG VALUES:", { name, jobTitle, weightRaw, weight });

    if (!name || !jobTitle || isNaN(weight) || weight <= 0) {
      alert("Invalid inputs. Weight must be 0 or greater.");
      return;
    }

    const newEmployee = { id: crypto.randomUUID(), name, jobTitle, weight };
    setEmployees([...employees, newEmployee]);
    e.currentTarget.reset();
  };

  // TODO 8: Remove Employee Logic
  const handleRemoveEmployee = (id: string) => {
    // Filter the employee array to remove the matching ID.
    setEmployees(employees.filter(emp => emp.id !== id));
  };

  // --- VERIFICATION UI ---
  // The Variance Indicator will punish you mathematically if your rounding leaks pennies.
  const isMathValid = totalTip >= sumOfPaidTips;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Verification Dashboard */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="flex justify-between items-center mb-4 border-b pb-4">
            <h1 className="text-2xl font-bold text-gray-800">Tip Calculator Dashboard</h1>
            <label className="flex items-center space-x-2 text-sm font-semibold cursor-pointer">
              <input 
                type="checkbox" 
                checked={roundToDollar}
                onChange={(e) => setRoundToDollar(e.target.checked)}
                className="w-4 h-4"
              />
              <span>Round to nearest dollar</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-100 rounded-lg border border-gray-200">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total Tip</p>
              <p className="text-3xl font-mono font-medium">${totalTip.toFixed(2)}</p>
            </div>
            <div className="p-4 bg-gray-100 rounded-lg border border-gray-200">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Sum of Paid Tips</p>
              <p className="text-3xl font-mono font-medium">${sumOfPaidTips.toFixed(2)}</p>
            </div>
            <div className={`p-4 rounded-lg border-2 transition-colors ${isMathValid ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
              <p className={`text-xs font-bold uppercase tracking-wider ${isMathValid ? 'text-green-700' : 'text-red-700'}`}>
                Variance Indicator
              </p>
              <p className={`text-3xl font-mono font-bold ${isMathValid ? 'text-green-600' : 'text-red-600'}`}>
                ${Math.abs(variance).toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Inputs Section */}
          <div className="md:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h2 className="text-lg font-bold mb-4">Tip Pool</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">Cash Tips ($)</label>
                  <input 
                    type="number" 
                    min="0"
                    step="0.01"
                    value={cashTip}
                    onChange={(e) => setCashTip(e.target.value ? parseFloat(e.target.value) : '')}
                    className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Credit Tips ($)</label>
                  <input 
                    type="number" 
                    min="0"
                    step="0.01"
                    value={creditTip}
                    onChange={(e) => setCreditTip(e.target.value ? parseFloat(e.target.value) : '')}
                    className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h2 className="text-lg font-bold mb-4">Add Employee</h2>
              <form onSubmit={handleAddEmployee} className="space-y-4">
                <input name="name" type="text" placeholder="Name" required className="w-full border border-gray-300 rounded p-2 text-sm" />
                <input name="jobTitle" type="text" placeholder="Job Title (e.g., Server)" required className="w-full border border-gray-300 rounded p-2 text-sm" />
                <input name="weight" type="number" min="0.01" step="0.01" placeholder="Share Weight (e.g., 100)" required className="w-full border border-gray-300 rounded p-2 text-sm" />
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors">
                  + Add to Roster
                </button>
              </form>
            </div>
          </div>

          {/* Roster Section */}
          <div className="md:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex justify-between items-end mb-4 border-b pb-2">
              <h2 className="text-lg font-bold">Employee Roster</h2>
              <span className="text-sm text-gray-500 font-semibold">Total Shares: {totalShares}</span>
            </div>
            
            {employees.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No employees added. Roster is empty.</p>
            ) : (
              <div className="space-y-3">
                {employees.map(emp => (
                  <div key={emp.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-100 rounded">
                    <div>
                      <p className="font-bold">{emp.name} <span className="text-xs text-gray-500 font-normal bg-gray-200 px-2 py-1 rounded ml-2">{emp.jobTitle}</span></p>
                      <p className="text-sm text-gray-600 mt-1">Weight: {emp.weight}</p>
                    </div>
                    <div className="flex items-center space-x-4">
                      <p className="font-mono font-bold text-lg text-blue-700">
                        ${getEmployeeCalculatedTip(emp.weight).toFixed(2)}
                      </p>
                      <button 
                        onClick={() => handleRemoveEmployee(emp.id)}
                        className="text-red-500 hover:text-red-700 font-bold px-2 py-1"
                      >
                        ✕
                      </button>
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