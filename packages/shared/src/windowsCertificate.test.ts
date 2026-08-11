// FILE: windowsCertificate.test.ts
// Purpose: Keeps Windows signer identity matching consistent across desktop and release checks.
// Layer: Shared utility tests

import { describe, expect, it } from "vitest";

import { matchesDistinguishedName, parseDistinguishedName } from "./windowsCertificate";

describe("windowsCertificate", () => {
  it("parses quoted and escaped distinguished-name values", () => {
    const parsed = parseDistinguishedName('CN=Veylen, O="Acme, Inc.", OU=Tools\\2C Desktop');

    expect(parsed.get("CN")).toBe("Veylen");
    expect(parsed.get("O")).toBe("Acme, Inc.");
    expect(parsed.get("OU")).toBe("Tools, Desktop");
  });

  it("matches expected fields independent of order and extra certificate fields", () => {
    expect(
      matchesDistinguishedName(
        "CN=Veylen, O=Acme Tools",
        "C=US, O=Acme Tools, CN=Veylen, SERIALNUMBER=1234",
      ),
    ).toBe(true);
  });

  it("rejects incomplete pins and mismatched signer fields", () => {
    expect(matchesDistinguishedName("CN=Veylen", "CN=Veylen, O=Acme Tools")).toBe(false);
    expect(matchesDistinguishedName("CN=Veylen, O=Acme Tools", "CN=Veylen, O=Other Tools")).toBe(
      false,
    );
  });
});
