export function clientLabel(client: { name: string; reference_number?: string | null; referenceNumber?: string | null }): string {
  const reference = client.reference_number ?? client.referenceNumber;
  return reference ? `${reference} · ${client.name}` : client.name;
}
