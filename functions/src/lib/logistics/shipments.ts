export const SHIPMENT_STATUSES = [
  "registered",
  "received",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
  "returned",
  "cancelled",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const STATUS_LABELS: Record<ShipmentStatus, string> = {
  registered: "Enregistré",
  received: "Reçu par HAIPAC",
  in_transit: "En transit",
  out_for_delivery: "En cours de livraison",
  delivered: "Livré",
  exception: "Une vérification est nécessaire",
  returned: "Retourné",
  cancelled: "Annulé",
};

const TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  registered: ["received", "exception", "cancelled"],
  received: ["in_transit", "exception", "cancelled"],
  in_transit: ["received", "out_for_delivery", "exception", "returned"],
  out_for_delivery: ["delivered", "in_transit", "exception"],
  delivered: [],
  exception: ["received", "in_transit", "out_for_delivery", "returned", "cancelled"],
  returned: [],
  cancelled: [],
};

export function canTransition(from: string, to: ShipmentStatus) {
  return SHIPMENT_STATUSES.includes(from as ShipmentStatus) && TRANSITIONS[from as ShipmentStatus].includes(to);
}
