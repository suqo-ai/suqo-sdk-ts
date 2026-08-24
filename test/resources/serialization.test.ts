import { describe, expect, it } from "vitest";
import { deserializeSubscriptionCustomer, serializeCustomerInput } from "../../src/resources/serialization.js";

describe("serializeCustomerInput", () => {
  it("maps the required root fields to snake_case, with no billing/shipping keys when omitted", () => {
    const wire = serializeCustomerInput({
      phone: "9800000000",
      fullName: "Jane Doe",
      email: "jane@example.com",
      address: "Kathmandu",
    });
    expect(wire).toEqual({
      phone: "9800000000",
      full_name: "Jane Doe",
      email: "jane@example.com",
      address: "Kathmandu",
    });
    expect(wire).not.toHaveProperty("billing");
    expect(wire).not.toHaveProperty("shipping");
  });

  it("prefixes every billing field with billing_, including the optional panVat when given", () => {
    const wire = serializeCustomerInput({
      phone: "9800000000",
      fullName: "Jane Doe",
      email: "jane@example.com",
      address: "Kathmandu",
      billing: {
        businessName: "Doe Traders",
        email: "billing@example.com",
        address: "Lalitpur",
        panVat: "123456789",
      },
    });
    expect(wire.billing).toEqual({
      billing_business_name: "Doe Traders",
      billing_email: "billing@example.com",
      billing_address: "Lalitpur",
      billing_pan_vat: "123456789",
    });
  });

  it("omits billing_pan_vat entirely when panVat wasn't given, rather than sending it as undefined", () => {
    const wire = serializeCustomerInput({
      phone: "9800000000",
      fullName: "Jane Doe",
      email: "jane@example.com",
      address: "Kathmandu",
      billing: { businessName: "Doe Traders", email: "billing@example.com", address: "Lalitpur" },
    });
    expect(wire.billing).not.toHaveProperty("billing_pan_vat");
  });

  it("does NOT prefix shipping fields — only billing gets the billing_ prefix (real backend asymmetry)", () => {
    const wire = serializeCustomerInput({
      phone: "9800000000",
      fullName: "Jane Doe",
      email: "jane@example.com",
      address: "Kathmandu",
      shipping: { phone: "9811111111", fullName: "John Doe", email: "john@example.com", address: "Bhaktapur" },
    });
    expect(wire.shipping).toEqual({
      phone: "9811111111",
      full_name: "John Doe",
      email: "john@example.com",
      address: "Bhaktapur",
    });
  });

  it("omits shipping.address entirely when it wasn't given", () => {
    const wire = serializeCustomerInput({
      phone: "9800000000",
      fullName: "Jane Doe",
      email: "jane@example.com",
      address: "Kathmandu",
      shipping: { phone: "9811111111", fullName: "John Doe", email: "john@example.com" },
    });
    expect(wire.shipping).not.toHaveProperty("address");
  });
});

describe("deserializeSubscriptionCustomer", () => {
  it("maps every root field from snake_case, and billing/shipping WITHOUT any prefix (read side has none)", () => {
    const customer = deserializeSubscriptionCustomer({
      phone: "9800000000",
      full_name: "Jane Doe",
      email: "jane@example.com",
      address: "Kathmandu",
      billing: { business_name: "Doe Traders", email: "billing@example.com", address: "Lalitpur", pan_vat: "123456789" },
      shipping: { phone: "9811111111", full_name: "John Doe", email: "john@example.com", address: "Bhaktapur" },
    });
    expect(customer).toEqual({
      phone: "9800000000",
      fullName: "Jane Doe",
      email: "jane@example.com",
      address: "Kathmandu",
      billing: { businessName: "Doe Traders", email: "billing@example.com", address: "Lalitpur", panVat: "123456789" },
      shipping: { phone: "9811111111", fullName: "John Doe", email: "john@example.com", address: "Bhaktapur" },
    });
  });

  it("a billing_-prefixed key on the read side (the write shape) is ignored, not misread", () => {
    // Proves the read and write paths don't accidentally share field-name logic — the read shape
    // genuinely never has this prefix, so a stray billing_business_name here must not surface.
    const customer = deserializeSubscriptionCustomer({
      billing: { billing_business_name: "Should Not Appear" },
    });
    expect(customer.billing).toEqual({});
  });

  it("null billing/shipping round-trips as null, not omitted or an empty object", () => {
    const customer = deserializeSubscriptionCustomer({ billing: null, shipping: null });
    expect(customer.billing).toBeNull();
    expect(customer.shipping).toBeNull();
  });

  it("a missing billing/shipping key stays absent, distinct from explicit null", () => {
    const customer = deserializeSubscriptionCustomer({ phone: "9800000000" });
    expect("billing" in customer).toBe(false);
    expect("shipping" in customer).toBe(false);
  });

  it("a wrong-typed field is omitted rather than fabricated or coerced", () => {
    const customer = deserializeSubscriptionCustomer({ phone: 12345, full_name: "Jane Doe" });
    expect("phone" in customer).toBe(false);
    expect(customer.fullName).toBe("Jane Doe");
  });

  it("a non-object wire value returns an empty object rather than throwing", () => {
    expect(deserializeSubscriptionCustomer(null)).toEqual({});
    expect(deserializeSubscriptionCustomer(undefined)).toEqual({});
    expect(deserializeSubscriptionCustomer("not an object")).toEqual({});
  });
});
