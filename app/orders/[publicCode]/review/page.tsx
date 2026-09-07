import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth/session";
import { getMyOrderDetail } from "@/lib/orders/get-my-order-detail";
import { getOrderReview } from "@/lib/reviews/get-order-review";
import { ReviewFormClient } from "@/components/orders/ReviewFormClient";
import { ReviewReadOnlyView } from "@/components/orders/ReviewReadOnlyView";

type PageProps = {
  params: Promise<{ publicCode: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { publicCode } = await params;
  return { title: `Review order ${publicCode} | Preshopps` };
}

/**
 * Serves both "Leave a review" (create) and "Edit review" (update within
 * the 7-day window) -- a review that exists but is past its edit window
 * renders read-only here instead ("View review"). Only reachable for the
 * buyer's own completed order: getMyOrderDetail already scopes rows to
 * auth.uid() (a public_code the caller doesn't own resolves to not_found,
 * identical to the main order detail page), and get_order_review returns
 * zero rows for anyone who isn't that order's buyer or its shop owner --
 * a seller landing here on their own shop's order is turned away by the
 * explicit viewerRole check below, never shown a buyer-only form.
 */
export default async function OrderReviewPage({ params }: PageProps) {
  const { publicCode } = await params;
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/orders/${publicCode}/review`)}`);
  }

  const orderResult = await getMyOrderDetail(publicCode);

  if (orderResult.status === "not_found") {
    notFound();
  }

  if (orderResult.status === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this order right now.</p>
      </div>
    );
  }

  const { order } = orderResult;

  if (order.status !== "completed") {
    notFound();
  }

  const reviewResult = await getOrderReview(order.orderId);

  if (reviewResult.status === "not_found" || (reviewResult.status === "found" && reviewResult.review.viewerRole !== "buyer")) {
    notFound();
  }

  if (reviewResult.status === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this review right now.</p>
      </div>
    );
  }

  const { review } = reviewResult;
  const purchasedItemTitles = order.items.filter((item) => item.status === "accepted").map((item) => item.title);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href={`/orders/${order.orderPublicCode}`} className="text-sm text-ink-secondary hover:text-ink">
        ← Back to order
      </Link>

      <h1 className="mt-3 text-xl font-bold text-ink lg:text-2xl">
        {review.reviewId === null ? "Leave a review" : review.canEditReview ? "Edit your review" : "Your review"}
      </h1>
      <p className="mt-1 text-sm text-ink-secondary">{order.shopName}</p>

      {review.reviewId === null && !review.canCreateReview && (
        <p className="mt-6 text-sm text-ink-secondary">This order isn&rsquo;t eligible for a review right now.</p>
      )}

      {review.reviewId === null && review.canCreateReview && (
        <ReviewFormClient
          mode="create"
          buyerId={user.id}
          orderId={order.orderId}
          orderPublicCode={order.orderPublicCode}
          purchasedItemTitles={purchasedItemTitles}
        />
      )}

      {review.reviewId !== null && review.canEditReview && (
        <ReviewFormClient
          mode="edit"
          buyerId={user.id}
          orderId={order.orderId}
          orderPublicCode={order.orderPublicCode}
          reviewId={review.reviewId}
          initialRating={review.rating ?? undefined}
          initialBody={review.body ?? undefined}
          initialImagePaths={review.imagePaths}
          initialImageUrls={review.imageUrls}
          purchasedItemTitles={purchasedItemTitles}
        />
      )}

      {review.reviewId !== null && !review.canEditReview && (
        <ReviewReadOnlyView
          rating={review.rating ?? 0}
          body={review.body}
          createdAt={review.createdAt as string}
          purchasedItemTitles={purchasedItemTitles}
          replyBody={review.replyBody}
          imageUrls={review.imageUrls}
        />
      )}
    </div>
  );
}
