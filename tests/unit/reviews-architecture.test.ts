import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("Reviews reads/writes never trust client-supplied identity", () => {
  it("get-order-review.ts calls get_order_review with only the order id", () => {
    const source = readFile("lib/reviews/get-order-review.ts");
    expect(source).toMatch(/rpc\(\s*["']get_order_review["']/);
    expect(source).not.toMatch(/p_user_id|p_caller_id|p_buyer_id|p_seller_id|p_shop_id/);
  });

  it("get-shop-reviews.ts calls get_shop_reviews with only shop id + pagination args", () => {
    const source = readFile("lib/reviews/get-shop-reviews.ts");
    expect(source).toMatch(/rpc\(\s*["']get_shop_reviews["']/);
    expect(source).not.toMatch(/p_user_id|p_caller_id|p_buyer_id/);
  });

  it("review-actions.ts (create/update) never sends a buyer/shop id -- identity comes from auth.uid() server-side", () => {
    const source = readFile("lib/reviews/review-actions.ts");
    expect(source).toMatch(/rpc\(\s*["']create_review["']/);
    expect(source).toMatch(/rpc\(\s*["']update_review["']/);
    expect(source).not.toMatch(/p_buyer_id|p_shop_id|p_user_id|p_caller_id/);
  });

  it("review-reply-actions.ts never sends a seller/shop id", () => {
    const source = readFile("lib/reviews/review-reply-actions.ts");
    expect(source).toMatch(/rpc\(\s*["']upsert_review_reply["']/);
    expect(source).not.toMatch(/p_seller_id|p_shop_id|p_user_id|p_caller_id/);
  });

  it("no reviews module ever selects the reviews or review_images tables directly -- every access goes through an RPC", () => {
    const files = [
      "lib/reviews/get-order-review.ts",
      "lib/reviews/get-shop-reviews.ts",
      "lib/reviews/review-actions.ts",
      "lib/reviews/review-reply-actions.ts",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.from\(\s*["']reviews["']\s*\)/);
      expect(source).not.toMatch(/\.from\(\s*["']review_images["']\s*\)/);
    }
  });
});

describe("no service-role bypass anywhere in the Reviews module", () => {
  it("no reviews file references a service-role key", () => {
    const files = [
      "lib/reviews/get-order-review.ts",
      "lib/reviews/get-shop-reviews.ts",
      "lib/reviews/review-actions.ts",
      "lib/reviews/review-reply-actions.ts",
      "components/orders/ReviewFormClient.tsx",
      "components/orders/ReviewImagePicker.tsx",
      "components/orders/BuyerOrderReviewSection.tsx",
      "components/orders/ReviewReadOnlyView.tsx",
      "components/seller/SellerReviewReplyClient.tsx",
      "components/seller/SellerOrderReviewSection.tsx",
      "components/shop/ShopReviewsClient.tsx",
      "components/shop/ShopReviewCard.tsx",
      "app/orders/[publicCode]/review/page.tsx",
      "lib/image-processing/upload-image.ts",
      "lib/image-processing/compress-image.ts",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });
});

describe("Reviews does not build out-of-scope modules", () => {
  it("does not build disputes UI or payments anywhere in the module", () => {
    const files = [
      "lib/reviews/get-order-review.ts",
      "lib/reviews/get-shop-reviews.ts",
      "lib/reviews/review-actions.ts",
      "lib/reviews/review-reply-actions.ts",
      "components/orders/ReviewFormClient.tsx",
      "components/seller/SellerReviewReplyClient.tsx",
      "components/shop/ShopReviewsClient.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/dispute_status|open a dispute|disputes table/i);
      expect(source).not.toMatch(/gcash|escrow|refund|payment intent/i);
    }
  });

  it("renders exactly one star rating control -- no separate product-specific rating field alongside the seller rating", () => {
    const source = readFile("components/orders/ReviewFormClient.tsx");
    const matches = source.match(/<StarRatingInput/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("does not introduce Supabase Realtime (channel/subscribe) anywhere in the module", () => {
    const files = [
      "lib/reviews/get-order-review.ts",
      "lib/reviews/get-shop-reviews.ts",
      "lib/reviews/review-actions.ts",
      "lib/reviews/review-reply-actions.ts",
      "components/shop/ShopReviewsClient.tsx",
      "components/seller/SellerReviewReplyClient.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.channel\(|\.subscribe\(|supabase\.realtime/i);
    }
  });

  it("does not insert notification rows from the frontend -- 0040 already inserts new_review/review_reply server-side", () => {
    const files = ["lib/reviews/review-actions.ts", "lib/reviews/review-reply-actions.ts"];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.from\(\s*["']notifications["']\s*\)/);
      expect(source).not.toMatch(/insert_notification|create_notification/i);
    }
  });
});

describe("Review reply has no delete path anywhere", () => {
  it("review-reply-actions.ts exports no delete/remove function", async () => {
    const reviewReplyActions = await import("@/lib/reviews/review-reply-actions");
    expect(Object.keys(reviewReplyActions).some((name) => /delete|remove/i.test(name))).toBe(false);
  });

  it("SellerReviewReplyClient.tsx defines no delete/remove handler or RPC call", () => {
    const source = readFile("components/seller/SellerReviewReplyClient.tsx");
    expect(source).not.toMatch(/delete_review_reply|onDelete|handleDelete|rpc\(\s*["']delete/i);
  });
});

describe("Review photo upload uses the shared media storage foundation", () => {
  it("ReviewFormClient submits create_review/update_review with the picker's current image paths, not a hardcoded array", () => {
    const source = readFile("components/orders/ReviewFormClient.tsx");
    expect(source).toMatch(/createReview\(orderId, rating, bodyToSend, imagePaths\)/);
    expect(source).toMatch(/updateReview\(reviewId as string, rating, bodyToSend, imagePaths\)/);
  });

  it("ReviewImagePicker uploads to the review-images bucket only, with the buyer's own id and order id -- never an arbitrary bucket/owner", () => {
    const source = readFile("components/orders/ReviewImagePicker.tsx");
    expect(source).toMatch(/uploadImage\(\s*["']review-images["']\s*,\s*buyerId\s*,\s*orderId/);
  });

  it("ReviewImagePicker caps selection at 2 images", () => {
    const source = readFile("components/orders/ReviewImagePicker.tsx");
    expect(source).toMatch(/MAX_IMAGES\s*=\s*2/);
  });

  it("no review component uploads via a service-role client or arbitrary bucket string", () => {
    const files = ["components/orders/ReviewImagePicker.tsx", "lib/image-processing/upload-image.ts"];
    for (const file of files) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
    }
  });
});

describe("Reviews migration 0047 is scoped to exactly one new read RPC", () => {
  it("0047_review_order_context_rpc adds get_order_review only, no schema/enum/policy change", () => {
    const source = readFile("supabase/migrations/0047_review_order_context_rpc.sql");
    expect(source).toMatch(/create or replace function public\.get_order_review/i);
    expect(source).not.toMatch(/create policy|drop policy|alter policy/i);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create or replace function public\.create_review/i);
    expect(source).not.toMatch(/create or replace function public\.update_review/i);
    expect(source).not.toMatch(/create or replace function public\.upsert_review_reply/i);
  });

  it("get_order_review is granted to authenticated only, never anon or public", () => {
    const source = readFile("supabase/migrations/0047_review_order_context_rpc.sql");
    expect(source).toMatch(/revoke all on function public\.get_order_review\([^)]*\) from public/i);
    expect(source).toMatch(/revoke all on function public\.get_order_review\([^)]*\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.get_order_review\([^)]*\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.get_order_review\([^)]*\) to anon/i);
  });
});
