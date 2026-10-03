import { describe, it, expect } from "vitest";
import { lookupFrameworkStandards } from "../src/standards/FrameworkStandardsService.js";

describe("Framework standards lookup", () => {
  it("returns template governance guidance for production style changes", async () => {
    const result = await lookupFrameworkStandards({
      query: "Never edit a style in a production drawing",
      topic: "templates",
      maxResults: 5,
    });

    expect(result.totalRulesLoaded).toBeGreaterThan(0);
    expect(result.matchedCount).toBeGreaterThan(0);
    expect(result.matches.some((match) => match.rule.toLowerCase().includes("production drawing"))).toBe(true);
  });

  it("returns label guidance for label-focused lookups", async () => {
    const result = await lookupFrameworkStandards({
      query: "profile labels proposed existing textstyle",
      topic: "labels",
      maxResults: 5,
    });

    expect(result.matchedCount).toBeGreaterThan(0);
    expect(result.matches.some((match) => match.tags.includes("labels") || match.rule.toLowerCase().includes("label"))).toBe(true);
  });
  it("serves the Miami-Dade WASD easement and separation rules (topic mdwasd)", async () => {
    const easement = await lookupFrameworkStandards({ query: "water main easement width", topic: "mdwasd", maxResults: 5 });
    expect(easement.matches.some((m) => m.sectionNumber === "UC-005 A.8" && m.rule.includes("12 feet") && m.rule.includes("15 feet") && m.rule.includes("23.5"))).toBe(true);

    const separation = await lookupFrameworkStandards({ query: "water sewer horizontal separation", topic: "mdwasd", maxResults: 5 });
    expect(separation.matches.some((m) => m.sectionNumber === "GS 1.5" && m.rule.includes("10 ft preferred") && m.rule.includes("6 ft minimum"))).toBe(true);
  });
});
