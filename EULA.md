# Evolve AI Enterprise — End User License Agreement (EULA)

**Effective Date:** 15 September 2026  
**Licensor:** Evolve Mind Solutions Pty Ltd (ABN 41 672 546 217)  
**Registered Office:** Level 1, 63-73 Ann Street, Surry Hills NSW 2010, Australia  
**Governing Jurisdiction:** New South Wales and the Commonwealth of Australia  

---

## IMPORTANT LEGAL NOTICE

PLEASE READ THIS END USER LICENSE AGREEMENT ("AGREEMENT" OR "EULA") CAREFULLY BEFORE DOWNLOADING, INSTALLING, COPYING, OR USING THE EVOLVE AI ENTERPRISE SOFTWARE ("SOFTWARE").

BY DOWNLOADING, INSTALLING, COPYING, OR USING THE SOFTWARE, OR BY APPLYING AN AUTHORIZED CRYPTOGRAPHIC LICENSE TOKEN, YOU (THE "LICENSEE") AGREE TO BE BOUND BY THE TERMS OF THIS AGREEMENT. IF YOU ARE ENTERING INTO THIS AGREEMENT ON BEHALF OF AN ENTERPRISE, COMPANY, GOVERNMENT INSTRUMENTALITY, OR OTHER LEGAL ENTITY, YOU REPRESENT AND WARRANT THAT YOU HAVE THE FULL LEGAL AUTHORITY TO BIND THAT ENTITY TO THIS AGREEMENT. IF YOU DO NOT HAVE SUCH AUTHORITY, OR IF YOU DO NOT AGREE WITH ALL THE TERMS OF THIS AGREEMENT, YOU MUST NOT DOWNLOAD, INSTALL, COPY, OR USE THE SOFTWARE.

---

## 1. Definitions

- **"Licensor"**, **"We"**, **"Us"**, or **"Our"** means **Evolve Mind Solutions Pty Ltd** (ABN 41 672 546 217).
- **"Licensee"**, **"You"**, or **"Your"** means the individual, commercial enterprise, corporate entity, or public sector organization licensing the Software under this Agreement.
- **"Software"** means the Evolve AI Enterprise Studio standalone executable application (`evolve-ai-enterprise-portable-*-win32-x64.exe`), VS Code / IDE extension packages, AST transpilation engines, local model connectors, schema generators, command-line utilities, updates, and accompanying technical documentation provided by Licensor.
- **"Cryptographic License Key"** means the authentic, digitally signed Ed25519 cryptographic token (e.g., `EM-ENT-V1.*`) or `license.json` credential bundle issued directly by Licensor to unlock commercial or evaluation capabilities.
- **"Authorized User"** means an employee, contractor, or technical personnel authorized by Licensee to access and execute the Software within the scope of Licensee's licensed seat count or site entitlement.
- **"Customer Code"** means all software, source code, repositories, database schemas, transpiled SQL, unit tests, configuration files, and architectural models authored, refactored, generated, or processed by Licensee using the Software.
- **"Evaluation Period"** means the temporary duration authorized by Licensor for internal testing, defaulting to thirty (30) calendar days from issuance unless otherwise agreed in writing.
- **"Order Form"** means any commercial procurement agreement, quote, invoice, or online order confirmation issued by Licensor specifying the licensed edition, seat quantity, and fee schedule.

---

## 2. Grant of License & Permitted Editions

Subject to Licensee's ongoing compliance with this Agreement and payment of applicable license fees, Licensor grants Licensee a non-exclusive, non-transferable, revocable license to install and execute the Software strictly in accordance with the applicable edition:

1. **Enterprise Evaluation / Trial License:**
   - Granted strictly for internal evaluation, operational testing, and technical validation by Authorized Users.
   - Restricted to a maximum duration of **thirty (30) calendar days** from the date of license issuance, unless extended in writing by Licensor.
   - Use in commercial production, customer-facing delivery, or billable operational workflows is strictly prohibited during the Evaluation Period unless transitioned to a Commercial License.

2. **Commercial Seat-Based License:**
   - Authorizes execution across the specific number of individual developer workstations designated in Licensee's Order Form and cryptographic license token.
   - Each seat may be allocated to an individual Authorized User within Licensee's organization.

3. **Commercial Enterprise Site License:**
   - Authorizes execution across developer workstations, virtual desktop infrastructure (VDI), and automated build environments within Licensee's designated legal entity, up to any ceiling specified in the applicable Order Form.

4. **Community / Developer Edition:**
   - Grants a zero-cost, limited license for individual developer personal utility and non-production evaluation utilizing local offline AI models (such as Ollama, Gemma 4, or Colibri).

---

## 3. Workstation Deployment & Air-Gapped Operation

1. **Organization / Team Scope (Standard Deployment):** Commercial Team and Enterprise Site licenses authorize deployment across all Authorized User workstations within Licensee's organization without requiring individual machine hardware registration.
2. **Air-Gapped Single-Node Enclaves:** Where Licensee specifically requests hardware-locked deployment for secure, isolated enclaves, the cryptographic token is bound to the requesting machine's CPU and hardware entropy hash.
3. **Zero Data Exfiltration Guarantee:**
   - The Software executes locally on Licensee's workstation or private corporate network.
   - Customer Code, prompts, ASTs, schemas, and proprietary project files **never leave Licensee's workstation or internal network**.
   - Offline Cryptographic Validation: License verification operates entirely offline using asymmetric Ed25519 public key cryptography. The runtime makes zero outbound network calls, heartbeat pings, or telemetry transmissions to Licensor's servers.
4. **Website Download Telemetry Disclosure:** Standalone binaries downloaded via Licensor's public website collect aggregate, privacy-compliant download metrics (anonymized IP masked to `140.203.xxx.xxx`, geographic region, and corporate ASN / organization tag) solely to monitor aggregate distribution volume. No telemetry operates within air-gapped runtimes.

---

## 4. Intellectual Property & 100% Customer Code Ownership

1. **100% Customer Code Ownership:** Licensee retains sole, exclusive, and unencumbered ownership of, and all intellectual property rights in and to, all Customer Code, transpiled SQL, schema migrations, unit tests, and software deliverables authored or generated using the Software. Licensor asserts zero copyright, ownership, or licensing interest in Licensee's outputs.
2. **Licensor Proprietary Rights:** Licensor (and its licensors) retains all worldwide right, title, interest, copyright, patent, trademark, trade secret, and other intellectual property rights in and to the Software, compilers, transpilers, AST engines, cryptographic algorithms, rules, user interfaces, documentation, and all updates, modifications, or derivative works thereof. No rights are granted to Licensee other than those expressly set forth in this Agreement.

---

## 5. License Restrictions & Prohibitions

Licensee shall not, and shall not permit any third party to:
1. Reverse engineer, decompile, disassemble, decrypt, unpack, or attempt to derive the source code, internal algorithms, or trade secrets of the Software;
2. Circumvent, tamper with, defeat, or forge Ed25519 cryptographic license signatures, key validation routines, or node-lock mechanisms;
3. Sublicense, sell, resell, rent, lease, distribute, timeshare, or provide the Software as a managed service bureau, service provider, or software-as-a-service (SaaS) to any third party outside Licensee's licensed organization;
4. Remove, alter, or obscure any copyright, trademark, confidentiality, or proprietary markings appearing on or in the Software or documentation;
5. Conduct competitive benchmarking, performance comparisons, or security penetration disclosure regarding the Software without Licensor's prior written consent;
6. Share or distribute Cryptographic License Keys or `license.json` files to unauthorized persons outside Licensee's licensed seat allocation.

---

## 6. AI Outputs & Mandatory Human Engineering Oversight

1. **Assisted Nature of Software:** Licensee acknowledges and agrees that the Software utilizes artificial intelligence models, statistical heuristics, and automated compiler transpilers to produce code suggestions, SQL translations, and schema mappings.
2. **Mandatory Engineering Oversight:** Automated outputs may contain errors, omissions, or suboptimal architectural patterns. **Licensee is solely responsible for conducting thorough human engineering review, verification, security auditing, syntax checking, and regression testing before deploying any generated or transpiled code into testing, staging, or production environments.**
3. **No Liability for Unverified Code:** Licensor accepts no liability whatsoever for any bugs, security vulnerabilities, database corruptions, outages, or financial loss resulting from the deployment of unreviewed or unverified AI-generated code.

---

## 7. Confidentiality

The Software, its architectural designs, compilers, cryptographic token structures, benchmark data, and any non-public evaluation materials constitute valuable proprietary trade secrets and confidential information of Licensor. Licensee agrees to protect such confidential information using the same degree of care it uses to protect its own confidential information of like nature, but no less than reasonable care.

---

## 8. Disclaimer of Warranties & Australian Consumer Law

1. **"AS IS" Provision:** TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SOFTWARE AND DOCUMENTATION ARE PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING BUT NOT LIMITED TO ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, OR NON-INFRINGEMENT. LICENSOR DOES NOT WARRANT THAT THE SOFTWARE WILL MEET LICENSEE'S REQUIREMENTS, OPERATE UNINTERRUPTED, OR BE ERROR-FREE.
2. **Australian Consumer Law (ACL) Guarantees:** Nothing in this Agreement excludes, restricts, or modifies any statutory condition, warranty, guarantee, right, or remedy conferred on Licensee by the *Competition and Consumer Act 2010* (Cth) (including the Australian Consumer Law) or any other applicable law that cannot be lawfully excluded, restricted, or modified.
3. **Limitation for Non-Excludable Guarantees:** To the full extent permitted by law, Licensor's liability for breach of any non-excludable statutory condition or guarantee is limited, at Licensor's sole discretion, to:
   - (a) Re-supplying the Software or relevant services;
   - (b) Paying the cost of having the Software or relevant services re-supplied; or
   - (c) Refunding the license fee paid by Licensee for the affected Software.

---

## 9. Limitation of Liability

1. **Consequential Loss Exclusion:** TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL LICENSOR (OR ITS DIRECTORS, OFFICERS, EMPLOYEES, AFFILIATES, OR AGENTS) BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL DAMAGES WHATSOEVER, INCLUDING LOSS OF PROFITS, REVENUE, DATA, BUSINESS OPPORTUNITIES, ANTICIPATED SAVINGS, GOODWILL, OR SYSTEM DOWNTIME, ARISING OUT OF OR IN CONNECTION WITH THIS AGREEMENT OR THE USE OR INABILITY TO USE THE SOFTWARE, REGARDLESS OF THE THEORY OF LIABILITY (CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY, OR STATUTE), EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
2. **Aggregate Liability Cap:** Licensor's total cumulative liability arising out of or related to this Agreement, the Software, or any services provided hereunder shall be strictly limited to the actual license fees paid by Licensee to Licensor in the twelve (12) months immediately preceding the event giving rise to the claim, or one hundred Australian dollars ($100.00 AUD) if the Software was provided without charge (including under an Evaluation or Trial License).

---

## 10. Term & Termination

1. **Term:** This Agreement becomes effective upon Licensee downloading, installing, copying, or executing the Software and remains in effect until terminated.
2. **Evaluation Expiration:** An Evaluation / Trial License automatically terminates upon expiry of the authorized Evaluation Period unless transitioned to a commercial license.
3. **Termination for Cause:** Licensor may terminate this Agreement immediately upon written notice if Licensee commits a material breach of this Agreement (including violation of Section 4, 5, or 7, or non-payment of license fees).
4. **Post-Termination Obligations:** Upon termination or expiration of this Agreement, Licensee must immediately cease all access to and use of the Software, securely destroy all copies of the Software and Cryptographic License Keys in its possession or control, and provide written certification of such destruction upon Licensor's request.
5. **Survival:** Sections 1, 4, 5, 6, 7, 8, 9, 10.4, 10.5, 11, 12, and 13 survive any termination or expiration of this Agreement.

---

## 11. Export Control & Sanctions

Licensee agrees to comply with all applicable export control and sanctions laws, including the Australian *Defence Trade Controls Act 2012* (Cth), the *Customs Act 1901* (Cth), and United Nations sanctions. Licensee warrants that it is not located in, organized under the laws of, or an agent of any restricted or sanctioned jurisdiction.

---

## 12. Governing Law & Dispute Resolution

1. **Governing Law:** This Agreement is governed by and construed in accordance with the laws in force in **New South Wales, Australia**, and the Commonwealth of Australia, without regard to conflict of law principles. The United Nations Convention on Contracts for the International Sale of Goods does not apply.
2. **Dispute Resolution:** In the event of any dispute arising out of or in connection with this Agreement, the parties shall first attempt in good faith to resolve the dispute through executive negotiation. If unresolved within thirty (30) calendar days, the dispute shall be submitted to commercial mediation administered in Sydney, New South Wales.
3. **Jurisdiction:** If mediation does not resolve the dispute, the parties irrevocably submit to the non-exclusive jurisdiction of the courts of New South Wales and the Federal Court of Australia.

---

## 13. General Provisions

1. **Entire Agreement:** This Agreement (together with any applicable Order Form) constitutes the entire agreement between the parties regarding the Software and supersedes all prior or contemporaneous negotiations, representations, discussions, or agreements.
2. **Severability:** If any provision of this Agreement is held to be invalid or unenforceable, that provision will be severed to the minimum extent necessary and the remaining provisions shall continue in full force and effect.
3. **No Waiver:** No failure or delay by Licensor in exercising any right under this Agreement shall operate as a waiver of that right.
4. **Assignment:** Licensee may not assign or transfer this Agreement or any rights hereunder without Licensor's prior written consent. Licensor may assign this Agreement in connection with a corporate reorganization, merger, or sale of assets.

---

## 14. Contact & Legal Notices

Legal notices and inquiries regarding this Agreement should be directed to:

**Evolve Mind Solutions Pty Ltd**  
ABN: 41 672 546 217  
Level 1, 63-73 Ann Street, Surry Hills NSW 2010, Australia  
Email: `support@evolveminds.com.au`  
Website: [https://www.evolveminds.com.au](https://www.evolveminds.com.au)
