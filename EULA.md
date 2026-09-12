# Evolve AI Enterprise — End User License Agreement (EULA)
**Effective Date:** 12 September 2026  
**Licensor:** Evolve Mind Solutions Pty Ltd (ABN 41 672 546 217)  
**Registered Office:** Level 1, 63-73 Ann Street, Surry Hills NSW 2010, Australia  
**Governing Jurisdiction:** New South Wales, Australia  

---

## IMPORTANT LEGAL NOTICE
PLEASE READ THIS END USER LICENSE AGREEMENT ("AGREEMENT" OR "EULA") CAREFULLY BEFORE DOWNLOADING, INSTALLING, COPYING, OR USING EVOLVE AI ENTERPRISE SOFTWARE ("SOFTWARE"). 

BY DOWNLOADING, INSTALLING, COPYING, OR USING THE SOFTWARE, OR BY APPLYING AN AUTHORIZED CRYPTOGRAPHIC LICENSE TOKEN, YOU (THE "LICENSEE") AGREE TO BE BOUND BY THE TERMS OF THIS AGREEMENT. IF YOU ARE ENTERING INTO THIS AGREEMENT ON BEHALF OF AN ENTERPRISE, COMPANY, OR GOVERNMENT INSTRUMENTALITY, YOU REPRESENT AND WARRANT THAT YOU HAVE THE AUTHORITY TO BIND THAT ENTITY.

---

## 1. Definitions
- **"Licensor"**, **"We"**, or **"Us"** means **Evolve Mind Solutions Pty Ltd** (ABN 41 672 546 217).
- **"Licensee"** or **"You"** means the individual, corporate enterprise, or government organisation licensing the Software.
- **"Software"** means the Evolve AI Enterprise Studio standalone executable (`evolve-ai-enterprise-portable-*-win32-x64.exe`), IDE extensions, local transpiler engines, model connectors, and accompanying documentation.
- **"Cryptographic License Key"** means the Ed25519 digitally signed token (e.g. `EM-ENT-V1.*`) or `license.json` credential bundle issued by Licensor.
- **"Customer Code"** means all software, source code, repositories, database schemas, transpiled SQL, tests, and architectural artifacts created, refactored, or processed by Licensee using the Software.

---

## 2. License Grants & Permitted Editions
Licensor grants Licensee a non-exclusive, non-transferable, revocable license to install and execute the Software according to the applicable tier:

1. **Enterprise Limited Pilot License:**
   - Granted strictly for internal evaluation, operational testing, and technical validation across designated pilot partners (e.g., CBA, ANZ, BHP, Defence, Sonic Healthcare, and approved enterprise trials).
   - **Evaluation Window:** Restricted to a maximum of **thirty (30) calendar days** from the date of license issuance, unless extended in writing by Licensor.
   - Commercial production deployment requires transitioning to a Commercial License.

2. **Commercial Seat-Based License:**
   - Authorizes execution across the specific number of developer workstations designated in Licensee's commercial procurement schedule and cryptographic license token.

3. **Commercial Enterprise Site License:**
   - Authorizes execution across an unlimited number of developer workstations and build environments within Licensee's organization.

4. **Community / Local Edition:**
   - Authorizes zero-cost local developer evaluation with local offline LLM model runtimes (Ollama, Gemma 4, Colibri).

---

## 3. Workstation Deployment & Hardware Binding
- **Organization / Team Licensing (Standard):** Commercial Team and Enterprise Site licenses authorize deployment across all developer machines within the licensed entity without individual workstation machine ID registration.
- **Air-Gapped Single-Node Enclaves:** Where specifically requested for isolated defense, intelligence, or high-security banking enclaves, the license is cryptographically bound to the requesting workstation's CPU and motherboard entropy hash.

---

## 4. Air-Gapped Operation & Zero Data Exfiltration Guarantee
- **Local Client-Side Processing:** The Software executes strictly on Licensee's local host machine or internal corporate model gateways.
- **Zero Exfiltration:** Customer Code, prompts, ASTs, and files **never leave Licensee's workstation or internal network**.
- **Offline Cryptographic Validation:** License verification uses asymmetric Ed25519 public key cryptography completely offline without phoning home or requiring internet access.
- **Download Telemetry Disclosure:** Website downloads record high-level anonymized counts (masked IP `140.203.xxx.xxx`, geographic region, and partner tags) solely to track aggregate distribution volumes. No telemetry runs within air-gapped runtimes.

---

## 5. Intellectual Property & 100% Customer Code Ownership
- **Customer Code Ownership:** Licensee retains 100% full, exclusive, and unencumbered ownership of all Customer Code, transpiled code, schemas, and deliverables. Licensor asserts zero copyright, ownership, or licensing interest in your outputs.
- **Licensor Proprietary Rights:** Licensor retains all ownership, copyright, and intellectual property rights in and to the Software, compilers, cryptographic frameworks, and documentation.

---

## 6. License Restrictions
Licensee shall not:
- Reverse engineer, decompile, or disassemble the Software;
- Tamper with, bypass, or forge Ed25519 cryptographic license signatures;
- Sublicense, rent, lease, resell, or distribute the Software to third parties outside Licensee's organization;
- Remove or alter any proprietary or trademark markings.

---

## 7. Disclaimer of Warranties & AI Verification
- **"As Is" Provision:** TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND.
- **Engineering Oversight:** Licensee acknowledges that AI-generated code suggestions and automated transpilation outputs must be reviewed, tested, and validated by qualified software engineers before release into production environments.

---

## 8. Limitation of Liability
- **Consequential Damages Waiver:** Neither party shall be liable for indirect, consequential, or punitive damages.
- **Liability Cap:** Licensor's aggregate liability under this Agreement is limited to the amount paid by Licensee in the twelve (12) months preceding the claim (or $100 AUD for unpaid Pilot evaluations), subject to non-excludable rights under the Australian Consumer Law.

---

## 9. Governing Law
This Agreement is governed by the laws of **New South Wales, Australia**. The parties submit to the non-exclusive jurisdiction of the courts of New South Wales.

---

## 10. Contact & Procurement Notices
**Evolve Mind Solutions Pty Ltd**  
ABN: 41 672 546 217  
Level 1, 63-73 Ann Street, Surry Hills NSW 2010, Australia  
Email: `support@evolveminds.com.au`  
Website: [https://www.evolveminds.com.au](https://www.evolveminds.com.au)
