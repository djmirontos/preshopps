import { Badge } from "@/components/ui/Badge";
import { getOrderStatusLabel, isPositiveOrderStatus, type OrderStatus } from "@/lib/orders/order-status-copy";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

type Props = {
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
};

/** Status is always communicated as text (the label), tone is only a
 * secondary visual reinforcement -- never the sole signal. */
export function OrderStatusBadge({ status, fulfillmentMethod }: Props) {
  return <Badge tone={isPositiveOrderStatus(status) ? "brand" : "neutral"}>{getOrderStatusLabel(status, fulfillmentMethod)}</Badge>;
}
