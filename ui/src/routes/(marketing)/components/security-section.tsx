import { Button } from "@rio.js/ui/button"
import { Icon, Icons } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

const certifications = [
  { name: "SOC 2 Type II", icon: Icons.badgeCheck },
  { name: "Secure Hosting", icon: Icons.lock },
  { name: "Enterprise Grade", icon: Icons.badgeCheck },
  { name: "ISO 27001", icon: Icons.badgeCheck },
]

export function SecuritySection() {
  return (
    <section className="w-full bg-scale-100 py-24">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="mb-4 text-4xl font-bold text-scale-1200 lg:text-5xl">
                Enterprise-grade security
              </h2>
              <p className="mb-6 text-lg leading-relaxed text-scale-1000">
                Your business data deserves the highest level of protection. All
                data is encrypted both in transit and at rest, with role-based
                access controls, audit logging, and compliance with global data
                protection standards. AES-256 for storage and TLS 1.2/1.3 for
                secure communication.
              </p>
              <Button variant="outline" icon={Icons.plus}>
                Learn more
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {certifications.map((cert, index) => (
                <div
                  key={index}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-scale-500 bg-scale-50 p-6 text-center"
                >
                  {cert.icon && (
                    <Icon
                      icon={cert.icon}
                      className="mb-3 text-5xl text-teal-600"
                    />
                  )}
                  <p className="text-sm font-semibold text-scale-1200">
                    {cert.name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
