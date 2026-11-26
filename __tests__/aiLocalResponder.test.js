import { describe, test, expect } from "vitest";
import {
  tryLocalServerIntent,
  classifyHexColor,
  productMatchesColorFamily,
} from "../src/services/aiLocalResponder.service.js";

const SIGNED_IN_USER = { _id: "507f1f77bcf86cd799439011", role: "customer", fullName: "Falguni" };

describe("NIRA Local AI Responder", () => {
  test("answers current time locally in IST", async () => {
    const res = await tryLocalServerIntent({ message: "what time is it", user: null });
    expect(res).not.toBeNull();
    expect(res.reply).toMatch(/IST/i);
    expect(res.clientActions).toEqual([]);
  });

  test("opens SearchOverlay with query on 'search for banarasi'", async () => {
    const res = await tryLocalServerIntent({ message: "search for banarasi", user: null });
    expect(res?.clientActions).toEqual([
      { type: "overlay", target: "search", query: "banarasi" },
    ]);
  });

  test("routes single-field dictation to account_address on /account and checkout_address on /checkout", async () => {
    const onAccount = await tryLocalServerIntent({
      message: "my city is Kolkata",
      user: SIGNED_IN_USER,
      currentPage: "/account",
    });
    expect(onAccount?.clientActions).toEqual([
      { type: "fill_form", formType: "account_address", fields: { city: "Kolkata" } },
    ]);

    const onCheckout = await tryLocalServerIntent({
      message: "my city is Kolkata",
      user: SIGNED_IN_USER,
      currentPage: "/checkout",
    });
    expect(onCheckout?.clientActions).toEqual([
      { type: "fill_form", formType: "checkout_address", fields: { city: "Kolkata" } },
    ]);

    const onContact = await tryLocalServerIntent({
      message: "my name is Falguni",
      user: null,
      currentPage: "/contact",
    });
    expect(onContact?.clientActions).toEqual([
      { type: "fill_form", formType: "contact", fields: { fullName: "Falguni" } },
    ]);
  });

  test("prompts guests to sign in when dictating an address field", async () => {
    const res = await tryLocalServerIntent({
      message: "my city is Kolkata",
      user: null,
      currentPage: "/account",
    });
    expect(res?.clientActions).toEqual([{ type: "navigate", path: "/account" }]);
  });

  test("escalates festival/styling queries to external LLM (returns null)", async () => {
    const res = await tryLocalServerIntent({
      message: "suggest a light saree for Diwali",
      user: SIGNED_IN_USER,
    });
    expect(res).toBeNull();
  });

  test("strictly separates pink (#b32950) from peacock teal (#104f55)", () => {
    expect(classifyHexColor("#b32950")).toBe("pink");
    expect(
      productMatchesColorFamily({ color: "Rani Rose", colorHex: "#b32950" }, "pink")
    ).toBe(true);
    expect(
      productMatchesColorFamily({ color: "Peacock Teal", colorHex: "#104f55" }, "pink")
    ).toBe(false);
  });
});