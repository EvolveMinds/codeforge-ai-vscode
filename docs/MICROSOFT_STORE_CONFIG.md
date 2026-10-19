# Microsoft Store Publishing Configuration & Identity Reference

> **Purpose:** Single source of truth for **Evolve AI Enterprise Studio** on the Microsoft Store. Any AI assistant or developer building for the Microsoft Store should refer to this document for package identity, Partner Center metadata, and build commands.

---

## 1. Product Identity Matrix

These values are registered with Microsoft Partner Center and are embedded directly into [`electron-builder.yml`](../electron-builder.yml):

| Parameter | Value | Description |
| :--- | :--- | :--- |
| **Product Name** | `Evolve AI Enterprise Studio` | Official app title on the Microsoft Store |
| **Package/Identity/Name** | `EvolveMindSolutionsPtyLtd.EvolveAIEnterpriseStudio` | Unique technical package name |
| **Package/Identity/Publisher** | `CN=30EABD61-4873-4D1D-9CC6-17F79E3943F6` | Official Microsoft Partner Center Publisher GUID |
| **Package/Properties/PublisherDisplayName** | `Evolve Mind Solutions Pty Ltd` | Verified legal company publisher name |
| **Package Family Name (PFN)** | `EvolveMindSolutionsPtyLtd.EvolveAIEnterpriseStudio_h36mw90jtj2t0` | Windows package family identifier |
| **Application ID** | `EvolveAIEnterpriseStudio` | Internal UWP/MSIX application manifest ID |
| **Store ID** | `9P1ZGC01ZVJV` | Global Store product catalog ID |
| **Product Type** | `MSIX or PWA app` | Store-hosted, auto-updating, Microsoft-signed package |

---

## 2. Company & Account Verification Details

| Property | Value |
| :--- | :--- |
| **Legal Entity** | Evolve Mind Solutions Pty Ltd |
| **Australian Business Number (ABN)** | `41 672 546 217` |
| **D-U-N-S Number** | `891479581` |
| **Registered Address** | Level 1, 63-73 Ann Street, Surry Hills NSW 2010, Australia |
| **Operations Address** | 314 Seven Hills Rd, Kings Langley NSW 2147, Australia |
| **Primary Website** | `https://www.evolveminds.com.au` |
| **Support Email** | `support@evolveminds.com.au` |
| **Privacy Policy URL** | `https://www.evolveminds.com.au/privacy` |

---

## 3. Build & Packaging Instructions

Building for the Microsoft Store is fully automated:

```bash
# 1. Compile TypeScript and synchronize desktop assets
npm run compile

# 2. Build the Store-ready MSIX package
npm run desktop:build:appx
# or: npm run desktop:build:msstore
```

### Artifact Output
* **Path:** `dist-desktop/evolve-ai-enterprise-<version>-msstore-x64.appx`
* **Size:** ~119 MB
* **Signing Note:** Built with `"reason=Windows Store only build"`. No local commercial certificate is needed; Microsoft signs the package with the official Windows Store root certificate upon Partner Center ingestion.

---

## 4. Partner Center Submission Checklist

When uploading a new release in [Microsoft Partner Center](https://partner.microsoft.com/dashboard):

1. **Pricing & Availability:**
   * Markets: `All worldwide markets (240 of 240)`
   * Retail price: `Free` *(Enterprise licensing is activated in-app via Ed25519 license keys)*
   * Visibility: `Public audience` & `Make available and discoverable in Store`

2. **Properties:**
   * Category: `Developer tools` &rarr; `Development`
   * Display mode: `PC` *(Uncheck Mixed Reality / VR options)*
   * Declarations:
     * `[x] This product incorporates generative AI features...` (Mandatory under Policy 10.8)
     * `[ ] Customers can use Windows 10/11 features to record and broadcast...` (Uncheck — games only)
   * System Requirements: Minimum `Keyboard`, `Mouse`, `4 GB Memory` (Recommended `8 GB`)

3. **Age Ratings (IARC):**
   * App type: `All Other App Types`
   * All safety questions (violence, nudity, social chat, crypto): `No`
   * Result: `Everyone / PEGI 3+ / All Ages`

4. **Packages:**
   * Upload `dist-desktop/evolve-ai-enterprise-<version>-msstore-x64.appx`
   * Target device family: `Windows 10/11 Desktop`

5. **Store Listings:**
   * Supported language: `English (United States)`
   * Screenshots: Minimum 1 high-resolution 1920x1080 screenshot of the FDE Delivery Studio interface
