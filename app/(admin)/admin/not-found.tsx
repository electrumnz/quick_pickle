import { DESTINATIONS } from "@/components/admin/shell/destinations";
import { PageHeader, PageSections, Section } from "@/components/admin/ui/page";
import { Card, Row, Rows } from "@/components/admin/ui/primitives";

/**
 * Not here — but you are still inside the admin.
 *
 * The sidebar, the search box and the nine destinations are all still on
 * screen, so a wrong address costs one click rather than a back button. The
 * copy is honest about the likeliest cause: this admin is being built, and a
 * section can exist in the sidebar a few days before its page does.
 */
export default function AdminNotFound() {
  return (
    <>
      <PageHeader
        title="That page is not here"
        lede="Either the address is wrong, or this part of the admin has not been built yet. Nothing has broken and nothing has been lost."
      />
      <PageSections>
        <Section
          title="The nine places everything lives"
          description="These are all there is. If it is not in this list, it is not in the admin."
        >
          <Card>
            <Rows>
              {DESTINATIONS.map((destination) => (
                <Row key={destination.id} href={destination.href}>
                  <p className="text-body-sm font-medium text-primary">
                    {destination.label}
                  </p>
                  <p className="mt-0.5 text-caption text-muted">
                    {destination.blurb}
                  </p>
                </Row>
              ))}
            </Rows>
          </Card>
        </Section>
      </PageSections>
    </>
  );
}
