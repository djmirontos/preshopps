import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth/session";
import { getMyShopOrderDetail } from "@/lib/seller/get-my-shop-order-detail";
import { SellerOrderDetailClient } from "@/components/seller/SellerOrderDetailClient";
import { SellerOrderReviewSection } from "@/components/seller/SellerOrderReviewSection";
import { DisputeSection } from "@/components/disputes/DisputeSection";
import { getOrderReview } from "@/lib/reviews/get-order-review";
import { getOrderDisputeSummary } from "@/lib/disputes/get-order-dispute-summary";

type PageProps = {
  params: Promise<{ publicCode: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { publicCode } = await params;
  return { title: `Order ${publicCode} | Preshopps` };
}

/**
 * Authenticated seller only. get_my_shop_order_detail (0043) scopes every
 * row to the caller's own shop server-side (shops.owner_id = auth.uid())
 * -- a public_code belonging to another seller's shop, or a nonexistent
 * one, both resolve to zero rows, mapped to the same notFound(), so a
 * direct URL to someone else's order behaves identically to "not found"
 * (never a distinguishing 403/permission error that would confirm the
 * order exists).
 */
export default async function SellerOrderDetailPage({ params }: PageProps) {
  const { publicCode } = await params;
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/seller/orders/${publicCode}`)}`);
  }

  const result = await getMyShopOrderDetail(publicCode);

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "error") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this order right now.</p>
      </div>
    );
  }

  const orderReviewResult = result.order.status === "completed" ? await getOrderReview(result.order.orderId) : null;
  const orderReview = orderReviewResult?.status === "found" ? orderReviewResult.review : null;

  const disputeSummaryResult = await getOrderDisputeSummary(result.order.orderId);
  const existingDispute = disputeSummaryResult.status === "found" ? disputeSummaryResult.summary : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/seller/orders" className="text-sm text-ink-secondary hover:text-ink">
        ← Back to Seller Orders
      </Link>

      <SellerOrderDetailClient initialOrder={result.order} />

      <DisputeSection
        orderId={result.order.orderId}
        orderStatus={result.order.status}
        viewerUserId={user.id}
        existingDispute={existingDispute}
      />

      <SellerOrderReviewSection review={orderReview} />
    </div>
  );
}
