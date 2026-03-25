import { useMemo } from "react"
import { Link, useLocation } from "react-router"
import { titleCase } from "scule"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rio.js/ui/collapsible"
import { cn } from "@rio.js/ui/lib/utils"

export function AttributeKey({
  className = "",
  name,
  ...props
}: {
  name: string
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} className={className}>
      {titleCase(name)}
    </span>
  )
}

export function AttributeName({
  name,
  className = "",
  ...props
}: {
  name: string
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("truncate", className)}
      data-attribute={name}
      title={name}
      {...props}
    >
      <AttributeKey name={name} title={name} />
    </span>
  )
}

export function Docs({ children }) {
  const location = useLocation()

  let active = useMemo(() => {
    let arr = location.pathname.split("/")
    return arr[arr.length - 1]
  }, [location])

  console.log(
    "active",
    actionRoutes.flatMap((item) => item),
  )

  return (
    <div className="flex flex-col bg-scale-100 h-screen gap-2 overflow-hidden">
      <div className="w-[100vw] bg-scale-200 p-5 sticky border-b border">
        <h1 className="flex gap-2">
          <span className="icon-[noto--shopping-bags]"></span>Smart Market{" "}
        </h1>
      </div>
      <div className="flex h-screen px-4">
        <div className="w-60 h-[85vh] overflow-y-auto hide-scroll flex flex-col border bg-scale-200 rounded-lg p-2 px-4 gap-3">
          {actionRoutes.map((item, index) => {
            return !item.subLinks ? (
              <Link
                to={item.link}
                className="w-9/12 flex gap-3 items-center"
                key={index}
              >
                <div
                  className={cn(
                    "rounded-md h-6 w-6 z-10 flex justify-center items-center bg-scale-900",
                  )}
                >
                  {/* <span
                  className={cn(
                    "text-base text-scale-1200",
                    "icon-[ic--sharp-draw]",
                  )}
                ></span> */}
                  <span className="text-base icon-[material-symbols--folder]"></span>
                </div>
                <h3 className={cn("font-normal text-md")}>
                  <AttributeName name={item.name} />
                </h3>
              </Link>
            ) : (
              <Collapsible
                defaultOpen
                className={cn(
                  "transition-all pb-3 flex flex-col gap-[1px] rounded-md w-full py-2 text-scale-1100 shadow-lg",
                )}
              >
                <CollapsibleTrigger className="w-9/12 flex gap-3 items-center">
                  <div
                    className={cn(
                      "rounded-md relative h-6 w-6 z-10 flex justify-center items-center bg-scale-900",
                    )}
                  >
                    <span
                      className={cn(
                        "text-base text-scale-1200",
                        "icon-[ic--sharp-draw]",
                      )}
                    ></span>
                  </div>
                  <AttributeName name={item.name} />
                </CollapsibleTrigger>
                <CollapsibleContent className="w-full flex gap-1 relative pt-1">
                  <div className="flex w-full flex-col gap-1 border-scale-900">
                    {item.subLinks.map((item, index) => (
                      <>
                        <div
                          className={cn(
                            "top-0 left-0 w-full h-6 rounded-md border border-transparent flex justify-start items-center transition-all hover:bg-scale-500 hover:border-scale-900",
                            active === item.name
                              ? "bg-brand-500/50 border border-brand-600"
                              : "text-foreground",
                          )}
                        >
                          <Link
                            key={index}
                            to={`${item.link}`}
                            className={cn(
                              "flex gap-2 px-6 w-[95%] items-center transition-all text-base duration-200 relative ml-3 text-foreground ",
                            )}
                          >
                            <div
                              className={cn(
                                "absolute top-3 left-0 w-3 h-[0.1rem] rounded-r-md bg-scale-900",
                              )}
                            ></div>
                            <div
                              className={cn(
                                "absolute -top-[15px] left-0 w-[0.1rem] h-[27px] bg-scale-900",
                              )}
                            ></div>
                            <span
                              className={cn(
                                "transition icon text-foreground",
                                item.icon,
                              )}
                            ></span>

                            <AttributeName
                              name={item.name}
                              className="font-normal text-base mt-[2px] transition"
                            />
                          </Link>
                        </div>
                      </>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
        <div className="flex flex-col">{children}</div>
      </div>
    </div>
  )
}

export function Navigation() {
  const location = useLocation()
  let active = useMemo(() => {
    let arr = location.pathname.split("/")
    return arr[arr.length - 1]
  }, [location])
  let routes = []
  actionRoutes.forEach((ele) => {
    if (ele.subLinks) {
      routes.push(...ele.subLinks)
    } else {
      routes.push(ele)
    }
  })

  const currentIndex = routes.findIndex((item) => item.name === active)
  console.log(currentIndex, active, "checkCurrentIndex")
  const nextPath =
    routes.length === currentIndex + 1
      ? routes[currentIndex]
      : routes[currentIndex + 1]
  const prevPath =
    currentIndex === 0 ? routes[currentIndex] : routes[currentIndex - 1]

  return (
    <div className="flex w-full gap-4">
      <Link
        to={prevPath?.link}
        className="flex-1 border border-brand-500 rounded-sm px-4 py-2 hover:scale-105 transition-all "
      >
        <div className="flex justify-between items-center">
          <span className="icon-[material-symbols--arrow-left-alt-rounded] text-3xl"></span>
          <div className="flex flex-col">
            <span className="text-base text-scale-900">Previous</span>
            {<AttributeName name={prevPath.name} />}
          </div>
        </div>
      </Link>
      <Link
        className={cn(
          "flex-1 border border-brand-500 rounded-sm px-4 py-2 hover:scale-105 transition-all",
        )}
        to={nextPath?.link}
      >
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-base text-scale-900">Next</span>
            {<AttributeName name={nextPath.name} />}
          </div>
          <span className="icon-[material-symbols--arrow-right-alt-rounded] text-3xl"></span>
        </div>
      </Link>
    </div>
  )
}

const actionRoutes = [
  {
    id: 1,
    name: "introduction",
    link: "./introduction",
    icon: "icon-[ic--sharp-draw] text-purple-700",
  },
  {
    id: 2,
    name: "layers",
    link: "./layers",
    icon: "icon-[ic--sharp-draw] text-purple-700",
  },
  {
    id: 3,
    name: "maptools",
    link: "./maptools",
    icon: "icon-[mdi--tools] text-red-700",
  },
  {
    id: 4,
    name: "actions",
    subLinks: [
      {
        id: 1,
        name: "actions",
        link: "./actions",
        icon: "icon-[ic--sharp-draw] text-purple-700",
      },
      {
        id: 2,
        name: "aggregation",
        link: "./aggregation",
        icon: "icon-[lepton--aggregation] text-purple-700",
      },
      {
        id: 3,
        name: "download",
        link: "./download",
        icon: "icon-[lepton--downlode] text-purple-700",
      },
      {
        id: 4,
        name: "saveaslayer",
        link: "./saveaslayer",
        icon: "icon-[lepton--save] text-purple-700",
      },
      {
        id: 5,
        name: "cannibalization",
        link: "./cannibalization",
        icon: "icon-[lepton--cannibalization] text-purple-700",
      },
      {
        id: 6,
        name: "heatmap",
        link: "./heatmap",
        icon: "icon-[carbon--heat-map-03] text-purple-700",
      },
      {
        id: 7,
        name: "point-distance",
        link: "./point-distance",
        icon: "icon-[ri--pin-distance-fill] text-purple-700",
      },
      {
        id: 8,
        name: "table",
        link: "./table",
        icon: "icon-[lepton--table] text-purple-700",
      },
      {
        id: 9,
        name: "toll",
        link: "./toll",
        icon: "icon-[lepton--toll] text-purple-700",
      },
      {
        id: 10,
        name: "fueling-station",
        link: "./fueling-station",
        icon: "icon-[noto--fuel-pump] text-purple-700",
      },
      {
        id: 11,
        name: "poi-along-the-route",
        link: "./poi-along-the-route",
        icon: "icon-[solar--map-point-rotate-bold] text-purple-700",
      },
      {
        id: 12,
        name: "intersection",
        link: "./intersection",
        icon: "icon-[lepton--cannibalization] text-purple-700",
      },
      {
        id: 13,
        name: "focus",
        link: "./focus",
        icon: "icon-[lepton--focus] text-purple-700",
      },
      {
        id: 13,
        name: "nearest-point",
        link: "./nearest-point",
        icon: "icon-[lepton--nearestpoint] text-purple-700",
      },
      {
        id: 14,
        name: "nearby-places",
        link: "./nearby-places",
        icon: "icon-[lepton--nearbyplaces] text-purple-700",
      },
      {
        id: 15,
        name: "donut",
        link: "./donut",
        icon: "icon-[lepton--donutanalysis] text-purple-700",
      },
    ],
    icon: "icon-[ic--sharp-draw] text-purple-700",
  },
  {
    id: 5,
    name: "region",
    link: "./region",
    icon: "icon-[ph--polygon-light] text-purple-700",
  },
  {
    id: 6,
    name: "inspector panel",
    subLinks: [
      {
        id: 1,
        name: "attributes",
        link: "./attributes",
        icon: "icon-[mdi--tools] text-purple-700",
      },
      {
        id: 2,
        name: "style",
        link: "./style",
        icon: "icon-[mdi--tools] text-purple-700",
      },
      {
        id: 3,
        name: "filter",
        link: "./filter",
        icon: "icon-[mdi--tools] text-purple-700",
      },
      {
        id: 4,
        name: "summary",
        link: "./summary",
        icon: "icon-[mdi--tools] text-purple-700",
      },
    ],
    icon: "icon-[mdi--tools] text-purple-700",
  },
]
