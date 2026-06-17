# 🍽️ TipSplitter (Weighted Share System)

**TipSplitter** is a high-contrast, mobile-first Web Application designed for restaurant managers to quickly and mathematically distribute pooled tips using a weighted point-share allocation engine. 

Built strictly to withstand fractional penny variances, it features an on-screen mathematical validation dashboard to audit total pool disbursements in real time.

---

## 🛠️ Tech Stack & Architecture

- **Framework:** React 19 + Vite (TypeScript strict mode)
- **Styling Layer:** Pure Tailwind CSS v4 (Mobile-First Dashboard)
- **State Engine:** Synchronous Lazy Initialization via Browser `localStorage`
- **Testing Methodology:** Socratic Test-Driven Verification Layout

---

## ✨ Core Engineering Features

- **Weighted Share Distribution:** Computes tip allocations using a point-weight matrix ($EmployeeTip = ValuePerShare \times EmployeeWeight$) rather than basic hour splits.
- **Pennies-to-Dollar Toggle:** Integrated UI switch modifying allocation rounding layers seamlessly between exact standard USD ($0.00) and rounded whole-dollar integers.
- **Mathematical Variance Auditing:** Live verification dashboard displaying the absolute delta between the total collected tip pool and the sum of actual distributed payouts to protect shifts from under/over-payouts.

---

## 📦 Getting Started & Local Installation

Ensure you have [Node.js](https://nodejs.org/) installed inside your environment before running.

1. **Clone the Repository:**
   ```bash
   git clone [https://github.com/ciraheta3/tip-calculator.git](https://github.com/ciraheta3/tip-calculator.git)
   cd tip-calculator
   ```

2. Install Dependencies:
  ```bash
  npm install
  ```
 
3. Launch the Development Server:
  ```bash
  npm run dev
  ```

---

## 🚀 Active Production Roadmap

Progress is tracked internally via our system repository `ROADMAP.md`.

- [x] **Milestone 1:** Core Derived Math Engine & Local Storage Persistence (V1.0)
- [ ] **Milestone 2:** Hardening Phase (Zero-Weight Validation Gates & Local Storage Type Safety)
- [ ] **Milestone 3:** Enterprise Payout Utilities (CSV Payroll Export Engine & Roster Templates)

---

## 📄 License & Terms
This project is proprietary and is protected under a private ownership license. Unauthorized copying, distribution, or modification of this source code via any medium is strictly prohibited.

---

## 👤 Author
**Carlos Iraheta** 📩 carlosiraheta543@gmail.com  
[Portfolio Link] | [LinkedIn]