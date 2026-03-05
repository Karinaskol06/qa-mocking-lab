export type OrderItem = {
    sku: string;
    qty: number;
    price: number; // per unit
};

export type Order = {
    id: string;
    userEmail: string;
    items: OrderItem[];
    couponCode?: string | null;
    createdAtIso: string;
};

export type PaymentResult = {
    status: "approved" | "declined";
    transactionId?: string;
    declineReason?: string;
};

export interface PaymentClient {
    charge(amountCents: number, currency: "USD" | "EUR", orderId: string): Promise<PaymentResult>;
}

export interface EmailClient {
    send(to: string, subject: string, body: string): Promise<void>;
}

export type CreateOrderInput = {
    userEmail: string;
    items: OrderItem[];
    couponCode?: string | null;
    currency: "USD" | "EUR";
};

export type CreateOrderResult = {
    order: Order;
    totalCents: number;
    payment: PaymentResult;
};

/**
 * OrderService — навмисно має багато логіки, яку студенти повинні покрити тестами.
 * Частина вже покрита “базовими” тестами (~30%).
 */
export class OrderService {
    constructor(
        private readonly paymentClient: PaymentClient,
        private readonly emailClient: EmailClient
    ) {}

    async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
        // 1) validate
        this.validateInput(input);

        // 2) normalize
        const normalizedEmail = input.userEmail.trim().toLowerCase();
        const orderId = this.generateId();
        const createdAtIso = new Date().toISOString();

        // 3) calculate total
        const subtotalCents = this.calcSubtotalCents(input.items);
        const discountCents = this.calcDiscountCents(subtotalCents, input.couponCode);
        const shippingCents = this.calcShippingCents(subtotalCents, input.currency);
        const taxCents = this.calcTaxCents(subtotalCents - discountCents, input.currency);

        const totalCents = Math.max(0, subtotalCents - discountCents) + shippingCents + taxCents;

        // 4) fraud-ish rules (students should test!)
        this.applyRiskRules(normalizedEmail, totalCents);

        // 5) charge
        const payment = await this.paymentClient.charge(totalCents, input.currency, orderId);

        // 6) if declined → do NOT send email, throw error with reason
        if (payment.status === "declined") {
            throw new Error(`PAYMENT_DECLINED: ${payment.declineReason ?? "unknown"}`);
        }

        // 7) build order
        const order: Order = {
            id: orderId,
            userEmail: normalizedEmail,
            items: input.items.map((i) => ({ ...i })), // shallow copy
            couponCode: input.couponCode ?? null,
            createdAtIso,
        };

        // 8) confirmation email
        await this.emailClient.send(
            normalizedEmail,
            `Order ${order.id} confirmed`,
            this.buildEmailBody(order, totalCents, input.currency, payment.transactionId)
        );

        return { order, totalCents, payment };
    }

    // -----------------------
    // Implementation details
    // -----------------------

    private validateInput(input: CreateOrderInput) {
        if (!input.userEmail || !input.userEmail.includes("@")) {
            throw new Error("VALIDATION: invalid email");
        }
        if (!Array.isArray(input.items) || input.items.length === 0) {
            throw new Error("VALIDATION: empty items");
        }
        for (const it of input.items) {
            if (!it.sku || typeof it.sku !== "string") throw new Error("VALIDATION: invalid sku");
            if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error("VALIDATION: invalid qty");
            if (typeof it.price !== "number" || it.price <= 0) throw new Error("VALIDATION: invalid price");
            if (!Number.isFinite(it.price)) throw new Error("VALIDATION: invalid price");
        }
    }

    private calcSubtotalCents(items: OrderItem[]): number {
        // use cents rounding
        let sum = 0;
        for (const it of items) {
            sum += Math.round(it.price * 100) * it.qty;
        }
        return sum;
    }

    private calcDiscountCents(subtotalCents: number, couponCode?: string | null): number {
        const code = (couponCode ?? "").trim().toUpperCase();
        if (!code) return 0;

        // Students should test these branches
        if (code === "SAVE10") return Math.floor(subtotalCents * 0.1);
        if (code === "SAVE20") return Math.floor(subtotalCents * 0.2);
        if (code === "FREESHIP") return 0; // shipping handled elsewhere
        if (code.startsWith("WELCOME")) return Math.min(1500, Math.floor(subtotalCents * 0.05)); // max $15
        throw new Error("VALIDATION: unknown coupon");
    }

    private calcShippingCents(subtotalCents: number, currency: "USD" | "EUR"): number {
        // Students should test currency and coupon interaction
        const base = currency === "USD" ? 799 : 699;
        if (subtotalCents >= 5000) return 0; // free shipping over $50/€50
        return base;
    }

    private calcTaxCents(taxableCents: number, currency: "USD" | "EUR"): number {
        if (taxableCents <= 0) return 0;

        // Students should test VAT/Tax difference
        if (currency === "EUR") {
            // VAT 20%
            return Math.round(taxableCents * 0.2);
        }
        // US tax 8.25%
        return Math.round(taxableCents * 0.0825);
    }

    private applyRiskRules(email: string, totalCents: number) {
        // Students should test these rules
        if (email.endsWith("@tempmail.com")) {
            throw new Error("RISK: tempmail is not allowed");
        }
        if (totalCents > 200_000) {
            // > $2000
            throw new Error("RISK: amount too high");
        }
        if (email.includes("+") && totalCents > 50_000) {
            // plus aliasing for high amounts
            throw new Error("RISK: plus-alias high amount");
        }
    }

    private buildEmailBody(order: Order, totalCents: number, currency: "USD" | "EUR", transactionId?: string) {
        const money = this.formatMoney(totalCents, currency);
        const lines = order.items.map((i) => `- ${i.sku} x${i.qty}`);
        const body = [
            `Thanks for your purchase!`,
            ``,
            `Order: ${order.id}`,
            `Items:`,
            ...lines,
            ``,
            `Total: ${money}`,
        ];

        if (transactionId) {
            body.push(`Transaction ID: ${transactionId}`);
        }

        return body.join("\n");
    }

    private formatMoney(cents: number, currency: "USD" | "EUR") {
        const amount = (cents / 100).toFixed(2);
        return currency === "USD" ? `$${amount}` : `€${amount}`;
    }

    private generateId() {
        // not crypto-safe; fine for lab
        return `ord_${Math.random().toString(16).slice(2, 10)}`;
    }
}