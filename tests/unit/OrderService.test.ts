import { OrderService, PaymentClient, EmailClient } from "../../src/service/OrderService";

describe("OrderService Unit Tests", () => {

    let paymentClient: jest.Mocked<PaymentClient>;
    let emailClient: jest.Mocked<EmailClient>;
    let service: OrderService;

    beforeEach(() => {
        //create fresh mocks before each test
        paymentClient = {
            charge: jest.fn(),
        };

        emailClient = {
            send: jest.fn(),
        };
        service = new OrderService(paymentClient, emailClient);
    });

    //happy path (didn't change)
    test("creates order and sends confirmation email on approved payment (happy path)", async () => {
        const paymentClient: PaymentClient = {
            charge: jest.fn().mockResolvedValue({ status: "approved", transactionId: "tx_123" }),
        };

        const emailClient: EmailClient = {
            send: jest.fn().mockResolvedValue(undefined),
        };

        const service = new OrderService(paymentClient, emailClient);

        const result = await service.createOrder({
            userEmail: "  USER@Example.com ",
            currency: "USD",
            items: [
                { sku: "A-1", qty: 2, price: 10.0 }, // $20
            ],
            couponCode: null,
        });

        expect(result.order.userEmail).toBe("user@example.com");
        expect(result.payment.status).toBe("approved");

        // charge called
        expect(paymentClient.charge).toHaveBeenCalledTimes(1);
        const [amountCents, currency, orderId] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(currency).toBe("USD");
        expect(typeof orderId).toBe("string");
        expect(orderId.startsWith("ord_")).toBe(true);

        // email called
        expect(emailClient.send).toHaveBeenCalledTimes(1);
        const [to, subject, body] = (emailClient.send as jest.Mock).mock.calls[0];
        expect(to).toBe("user@example.com");
        expect(subject).toContain("confirmed");
        expect(body).toContain("Total:");
    });

    //can't create an order without any products
    test("throws validation error for empty items", async () => {
        const paymentClient: PaymentClient = {
            charge: jest.fn(),
        };
        const emailClient: EmailClient = {
            send: jest.fn(),
        };

        const service = new OrderService(paymentClient, emailClient);

        await expect(
            service.createOrder({
                userEmail: "test@example.com",
                currency: "USD",
                items: [],
            })
        ).rejects.toThrow("VALIDATION: empty items");

        expect(paymentClient.charge).not.toHaveBeenCalled();
        expect(emailClient.send).not.toHaveBeenCalled();
    });

    /* new validation tests */
    describe("Validation Tests", () => {
        test("invalid email (without @) - Validation: invalid email", async () => {

            await expect(
                service.createOrder({
                    userEmail: "invalid-email", //without @
                    currency: "USD",
                    items: [{ sku: "A-1", qty: 1, price: 10.0 }],
                    couponCode: null,
                })
            ).rejects.toThrow("VALIDATION: invalid email");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("invalid sku (empty) - Validation: invalid sku", async () => {

            await expect(
                service.createOrder({
                    userEmail: "user@example.com",
                    currency: "USD",
                    items: [{ sku: "", qty: 1, price: 10.0 }],
                    couponCode: null,
                })
            ).rejects.toThrow("VALIDATION: invalid sku");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("invalid qty (0) - Validation: invalid qty", async () => {

            await expect(
                service.createOrder({
                    userEmail: "user@example.com",
                    currency: "USD",
                    items: [{ sku: "A-1", qty: 0, price: 10.0 }],
                    couponCode: null,
                })
            ).rejects.toThrow("VALIDATION: invalid qty");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("invalid qty (negative) - Validation: invalid qty", async () => {

            await expect(
                service.createOrder({
                    userEmail: "user@example.com",
                    currency: "USD",
                    items: [{ sku: "A-1", qty: -1, price: 10.0 }],
                    couponCode: null,
                })
            ).rejects.toThrow("VALIDATION: invalid qty");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("invalid qty (not integer) - Validation: invalid qty", async () => {

            await expect(
                service.createOrder({
                    userEmail: "user@example.com",
                    currency: "USD",
                    items: [{ sku: "A-1", qty: 1.5, price: 10.0 }],
                    couponCode: null,
                })
            ).rejects.toThrow("VALIDATION: invalid qty");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("invalid price (<= 0) - Validation: invalid price", async () => {

            await expect(
                service.createOrder({
                    userEmail: "user@example.com",
                    currency: "USD",
                    items: [{ sku: "A-1", qty: 1, price: 0 }],
                    couponCode: null,
                })
            ).rejects.toThrow("VALIDATION: invalid price");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("invalid price (not a num) - Validation: invalid price", async () => {

            await expect(
                service.createOrder({
                    userEmail: "user@example.com",
                    currency: "USD",
                    items: [{ sku: "A-1", qty: 1, price: NaN }],
                    couponCode: null,
                })
            ).rejects.toThrow("VALIDATION: invalid price");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("invalid price (infinity) - Validation: invalid price", async () => {

            await expect(
                service.createOrder({
                    userEmail: "user@example.com",
                    currency: "USD",
                    items: [{ sku: "A-1", qty: 1, price: Infinity }],
                    couponCode: null,
                })
            ).rejects.toThrow("VALIDATION: invalid price");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });
    });

    /* coupons and discounts */
    describe("Coupon/Discount Tests", () => {
        beforeEach(() => {
            //mock a successful payment
            paymentClient.charge = jest.fn().mockResolvedValue({
                status: "approved",
                transactionId: "tx_123"
            });
            emailClient.send = jest.fn().mockResolvedValue(undefined);
            service = new OrderService(paymentClient, emailClient);
        });

        test("10% discount", async () => {
            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 100.00 }],
                couponCode: "SAVE10",
            };

            const result = await service.createOrder(orderData);

            expect(paymentClient.charge).toHaveBeenCalled();
            const [amountCents] = (paymentClient.charge as jest.Mock).mock.calls[0];

            // Discount (10%): -1000 cents = 9000 cents taxable
            // Tax (8.25%): +743 cents = 9743 cents
            // Shipping: free (subtotal >= 5000)
            expect(amountCents).toBe(9743);
        });

        test("20% discount", async () => {
            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 100.00 }],
                couponCode: "SAVE20",
            };

            const result = await service.createOrder(orderData);

            const [amountCents] = (paymentClient.charge as jest.Mock).mock.calls[0];
            // Subtotal: 10000
            // Discount (20%): -2000 = 8000 taxable
            // Tax (8.25%): +660 = 8660 cents
            expect(amountCents).toBe(8660);
        });

        test("welcome discount - 5% (max $15 (1500 cents))", async () => {
            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 500.00 }], //50000 cents
                couponCode: "WELCOME",
            };

            const result = await service.createOrder(orderData);

            const [amountCents] = (paymentClient.charge as jest.Mock).mock.calls[0];

            // Subtotal: 50000
            // Discount (max 1500): -1500 = 48500 taxable
            // Tax (8.25%): +4001 = 52501 cents
            expect(amountCents).toBe(52501);
        });

        test("WELCOME with a small sum (discount is less than limit)", async () => {
            // Given - small sum, discount is 5%
            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 100.00 }], // 10000 cents
                couponCode: "WELCOME",
            };

            const result = await service.createOrder(orderData);

            const [amountCents] = (paymentClient.charge as jest.Mock).mock.calls[0];

            expect(amountCents).toBe(10284);
        });

        test("unknown coupon - Validation: unknown coupon", async () => {

            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 100.00 }],
                couponCode: "UNKNOWN123",
            };

            await expect(
                service.createOrder(orderData)
            ).rejects.toThrow("VALIDATION: unknown coupon");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("coupon trimming/case-insensitive", async () => {
            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 100.00 }],
                couponCode: "  save10  ",
            };

            const result = await service.createOrder(orderData);

            const [amountCents] = (paymentClient.charge as jest.Mock).mock.calls[0];

            // Calculate expected total:
            // Subtotal: 10000 cents
            // Discount (10%): -1000 cents = 9000 cents taxable
            // Tax (8.25%): +743 cents (9000 * 0.0825 = 742.5, rounded to 743)
            // Shipping: free (subtotal >= 5000)
            // Total: 9000 + 743 = 9743 cents
            expect(amountCents).toBe(9743); // Update expected value
        });
    });

    /* shipping */
    describe("Shipping Tests", () => {
        beforeEach(() => {
            paymentClient.charge = jest.fn().mockResolvedValue({ status: "approved" });
            emailClient.send = jest.fn().mockResolvedValue(undefined);
            service = new OrderService(paymentClient, emailClient);
        });

        test("shipping is free when subtotal >= 5000 cents", async () => {
            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 50.00 }], // 5000 cents
                couponCode: null,
            };

            const result = await service.createOrder(orderData);

            // Subtotal: 5000
            // Tax (8.25%): +413 = 5413 cents
            // Shipping: free
            expect(result.totalCents).toBe(5413);
        });

        test("shipping is paid when subtotal < 5000 cents", async () => {
            // Given - subtotal = 4000 cents (< 5000)
            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 40.00 }], // 4000 cents
                couponCode: null,
            };

            const result = await service.createOrder(orderData);

            expect(result.totalCents).toBeGreaterThan(4000);
        });

        test("USD vs EUR basic shipping is different", async () => {
            // Given - same products, different currency
            const baseOrder = {
                userEmail: "user@example.com",
                items: [{ sku: "A-1", qty: 1, price: 30.00 }], // 3000 cents
                couponCode: null,
            };

            const usdResult = await service.createOrder({
                ...baseOrder,
                currency: "USD",
            });

            const eurResult = await service.createOrder({
                ...baseOrder,
                currency: "EUR",
            });

            //sums have to differ
            const [usdAmount] = (paymentClient.charge as jest.Mock).mock.calls[0];
            const [eurAmount] = (paymentClient.charge as jest.Mock).mock.calls[1];

            expect(usdAmount).not.toBe(eurAmount);
        });
    });

    /* taxes */
    describe("Tax Tests", () => {
        beforeEach(() => {
            paymentClient.charge = jest.fn().mockResolvedValue({ status: "approved" });
            emailClient.send = jest.fn().mockResolvedValue(undefined);
            service = new OrderService(paymentClient, emailClient);
        });

        test("EUR VAT 20%", async () => {

            const orderData = {
                userEmail: "user@example.com",
                currency: "EUR" as const,
                items: [{ sku: "A-1", qty: 1, price: 100.00 }], // 10000 cents
                couponCode: null,
            };

            const result = await service.createOrder(orderData);

            const [amountCents] = (paymentClient.charge as jest.Mock).mock.calls[0];

            // Basic price 10000 + 20% tax = 12000
            expect(amountCents).toBeGreaterThan(10000);
        });

        test("USD tax 8.25%", async () => {

            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 100.00 }], // 10000 cents
                couponCode: null,
            };

            const result = await service.createOrder(orderData);

            const [amountCents] = (paymentClient.charge as jest.Mock).mock.calls[0];

            // Basic price 10000 + 8.25% tax = 10825
            expect(amountCents).toBeGreaterThan(10000);
        });
    });

    /* risk rules */
    describe("Risk Rules Tests", () => {
        beforeEach(() => {
            paymentClient.charge = jest.fn().mockResolvedValue({ status: "approved" });
            emailClient.send = jest.fn().mockResolvedValue(undefined);
            service = new OrderService(paymentClient, emailClient);
        });

        test("email @tempmail.com - RISK: tempmail is not allowed", async () => {

            const orderData = {
                userEmail: "user@tempmail.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 10.00 }],
                couponCode: null,
            };

            await expect(
                service.createOrder(orderData)
            ).rejects.toThrow("RISK: tempmail is not allowed");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("total > 200000 cents - RISK: amount too high", async () => {

            const orderData = {
                userEmail: "test@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 2500.00 }], // 250000 cents
                couponCode: null,
            };

            await expect(
                service.createOrder(orderData)
            ).rejects.toThrow("RISK: amount too high");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("email has '+' and total > 50000 cents - RISK: plus-alias high amount", async () => {

            const orderData = {
                userEmail: "test+alias@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 600.00 }],
                couponCode: null,
            };

            await expect(
                service.createOrder(orderData)
            ).rejects.toThrow("RISK: plus-alias high amount");

            expect(paymentClient.charge).not.toHaveBeenCalled();
            expect(emailClient.send).not.toHaveBeenCalled();
        });
    });

    /* payment and email behavior */
    describe("Payment and Email Behavior", () => {
        test("payment declined - error PAYMENT_DECLINED and email isn't sent", async () => {

            paymentClient.charge = jest.fn().mockRejectedValue(
                new Error("PAYMENT_DECLINED: Insufficient funds")
            );
            emailClient.send = jest.fn().mockResolvedValue(undefined);
            service = new OrderService(paymentClient, emailClient);

            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 100.00 }],
                couponCode: null,
            };

            await expect(
                service.createOrder(orderData)
            ).rejects.toThrow("PAYMENT_DECLINED");

            expect(paymentClient.charge).toHaveBeenCalledTimes(1);
            expect(emailClient.send).not.toHaveBeenCalled();
        });

        test("approved - email is sent once with expected params", async () => {

            paymentClient.charge = jest.fn().mockResolvedValue({
                status: "approved",
                transactionId: "tx_123"
            });
            emailClient.send = jest.fn().mockResolvedValue(undefined);
            service = new OrderService(paymentClient, emailClient);

            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [{ sku: "A-1", qty: 1, price: 100.00 }],
                couponCode: null,
            };

            const result = await service.createOrder(orderData);

            expect(paymentClient.charge).toHaveBeenCalledTimes(1);
            expect(emailClient.send).toHaveBeenCalledTimes(1);

            const [to, subject, body] = (emailClient.send as jest.Mock).mock.calls[0];
            expect(to).toBe("user@example.com");
            expect(subject).toContain("confirmed");
            expect(body).toContain("Total:");
            expect(body).toContain("tx_123");
        });

        test("paymentClient.charge is called with correct sum and curr", async () => {

            paymentClient.charge = jest.fn().mockResolvedValue({ status: "approved" });
            emailClient.send = jest.fn().mockResolvedValue(undefined);
            service = new OrderService(paymentClient, emailClient);

            const orderData = {
                userEmail: "user@example.com",
                currency: "EUR" as const,
                items: [
                    { sku: "A-1", qty: 2, price: 25.50 },
                    { sku: "B-2", qty: 1, price: 30.25 },
                ],
                couponCode: "SAVE10",
            };
            const result = await service.createOrder(orderData);

            expect(paymentClient.charge).toHaveBeenCalledTimes(1);
            const [amountCents, currency, orderId] = (paymentClient.charge as jest.Mock).mock.calls[0];

            expect(currency).toBe("EUR");
            expect(typeof amountCents).toBe("number");
            expect(amountCents).toBeGreaterThan(8000);
            expect(amountCents).toBeLessThan(10000);
        });
    });

    /* edge cases */
    describe("Edge Cases", () => {
        beforeEach(() => {
            paymentClient.charge = jest.fn().mockResolvedValue({status: "approved"});
            emailClient.send = jest.fn().mockResolvedValue(undefined);
            service = new OrderService(paymentClient, emailClient);
        });

        test("round off price (10.005)", async () => {
            const orderData = {
                userEmail: "user@example.com",
                currency: "EUR" as const,
                items: [{ sku: "A-1", qty: 1, price: 10.005 }],
                couponCode: null,
            };

            const result = await service.createOrder(orderData);

            const [amountCents] = (paymentClient.charge as jest.Mock).mock.calls[0];

            // 10.005 * 100 = 1000.5, rounds to either 1000 or 1001
            // Tax (20%): +200 or +200 (200.2 rounds to 200)
            // Shipping (since subtotal < 5000): 699 cents
            // If rounded down: 1000 + 200 + 699 = 1899
            // If rounded up: 1001 + 200 + 699 = 1900
            const possibleValues = [1899, 1900];

            expect(possibleValues).toContain(amountCents);
        });

        test("several items - correct subtotal", async () => {

            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items: [
                    {sku: "A-1", qty: 2, price: 10.00}, // 20.00
                    {sku: "B-2", qty: 3, price: 5.00},  // 15.00
                    {sku: "C-3", qty: 1, price: 20.00}, // 20.00
                ],
                couponCode: null,
            };
            const result = await service.createOrder(orderData);

            const [amountCents] = (paymentClient.charge as jest.Mock).mock.calls[0];

            // Subtotal = 20.00 + 15.00 + 20.00 = 55.00 = 5500 cents
            expect(amountCents).toBeGreaterThan(5500);
        });

        test("discount doesn't make total negative", async () => {

            const orderData = {
                userEmail: "test@example.com",
                currency: "USD" as const,
                items: [{sku: "A-1", qty: 1, price: 5.00}],
                couponCode: "SAVE20",
            };

            const result = await service.createOrder(orderData);

            const [amountCents] = (paymentClient.charge as jest.Mock).mock.calls[0];

            expect(amountCents).toBeGreaterThan(0);
        });

        test("too much products", async () => {

            const items = Array(100).fill(null).map((_, i) => ({
                sku: `SKU-${i}`,
                qty: 10,
                price: 1.00
            }));

            const orderData = {
                userEmail: "user@example.com",
                currency: "USD" as const,
                items,
                couponCode: null,
            };

            const result = await service.createOrder(orderData);

            expect(paymentClient.charge).toHaveBeenCalled();
        });
    })

});