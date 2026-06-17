### 1. Core Math & Logic (Weighted Share System)
* Cash Tips + Credit Tips = Total Tip
* Total Shares = Sum of Employee Weights
* Value Per Share = Total Tip / Total Shares
* Employee Tip = Value Per Share * Employee Weight

### 2. Inputs and Outputs (with Edge Cases)
* **Tip Inputs:** Cash Tip and Credit Tip must be numeric inputs >= 0. Empty inputs default to 0.
* **Employee Inputs:** Ability to add/remove employees. Each employee requires a Name (string), Job Title (string), and Share Weight (numeric input >= 0, e.g., Server = 100, Busboy = 25).
* **Data Persistence:** NO backend database. Use browser localStorage to save and load the employee roster and their weights.

### 3. Logic Constraints (Precision & Verification)
* **Currency Formatting:** All calculated tips must be formatted in standard USD (e.g., $15.50).
* **Rounding Rule:** Round all individual calculated tips to exactly 2 decimal places. 
* **Rounding Toggle:** Provide a UI toggle to round individual tips to the nearest whole dollar instead.
* **Verification Check:** The UI must display the Total Tip alongside the Sum of Paid Tips (the sum of all individual rounded employee tips).
* **Variance Indicator:** Display the absolute mathematical difference between Total Tip and Sum of Paid Tips. The text must be Green if Total Tip >= Sum of Paid Tips, and Red if Total Tip < Sum of Paid Tips.

### 4. UI/UX Constraints
* Mobile-first design.
* Use pure Tailwind CSS via CDN or standard Vite installation (no heavy external component libraries like Material-UI).
* Clean, high-contrast, single-page dashboard layout.