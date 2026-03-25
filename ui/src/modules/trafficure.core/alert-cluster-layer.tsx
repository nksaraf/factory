import { CompositeLayer, CompositeLayerProps, DefaultProps } from "@rio.js/maps-ui/lib/deck-gl/core"
import Supercluster from "supercluster"

export interface AlertClusterLayerProps<T = any> extends CompositeLayerProps {
  /** Array of alert data items */
  data: T[]
  /** Function to extract coordinates [lng, lat] from each data item */
  getPosition: (d: T) => [number, number]
  /** Function to extract alert object from each data item */
  getAlert: (d: T) => any
  /** Cluster radius in pixels */
  radius?: number
  /** Maximum zoom level for clustering */
  maxZoom?: number
  /** Callback to notify parent if clustering is happening */
  onClusteringChange?: (hasClusters: boolean) => void
}

const defaultProps: DefaultProps<AlertClusterLayerProps<any>> = {
  radius: 50,
  maxZoom: 16,
}

/**
 * Composite layer that clusters alerts and shows:
 * - Clusters with count badges when zoomed out
 * - Individual alerts when zoomed in
 */
export default class AlertClusterLayer<T = any> extends CompositeLayer<
  AlertClusterLayerProps<T>
> {
  static layerName = "AlertClusterLayer"
  static defaultProps = defaultProps

  shouldUpdateState({ changeFlags }: any) {
    return changeFlags.somethingChanged
  }

  updateState({ props, oldProps, changeFlags }: any) {
    const rebuildIndex =
      changeFlags.dataChanged ||
      props.radius !== oldProps?.radius ||
      props.maxZoom !== oldProps?.maxZoom

    if (rebuildIndex && props.data && props.data.length > 0) {
      // Convert data to GeoJSON features for Supercluster
      const features = props.data.map((d: T, index: number) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: props.getPosition(d),
        },
        properties: {
          index,
          alert: props.getAlert(d),
          originalData: d,
        },
      }))

      const index = new Supercluster({
        maxZoom: props.maxZoom || defaultProps.maxZoom,
        radius: props.radius || defaultProps.radius,
      })
      index.load(features as any)
      this.setState({ index, features })
    }

    const z = Math.floor(this.context.viewport.zoom)
    const viewport = this.context.viewport
    const bounds = viewport.getBounds()
    const bbox: [number, number, number, number] = [
      bounds[0], // west
      bounds[1], // south
      bounds[2], // east
      bounds[3], // north
    ]
    
    // Check if viewport has changed significantly (for better performance)
    const bboxChanged = !this.state.lastBbox || 
      Math.abs(this.state.lastBbox[0] - bbox[0]) > 0.01 ||
      Math.abs(this.state.lastBbox[1] - bbox[1]) > 0.01 ||
      Math.abs(this.state.lastBbox[2] - bbox[2]) > 0.01 ||
      Math.abs(this.state.lastBbox[3] - bbox[3]) > 0.01

    if (rebuildIndex || z !== this.state.z || bboxChanged) {
      if (this.state.index) {
        // Always get clusters from Supercluster
        const clusters = this.state.index.getClusters(bbox, z)
        
        // Filter clusters: only show clusters with more than 2 points
        // Clusters with 2 or fewer points should show as individual alerts
        const actualClusters = clusters.filter(
          (c: any) => c.properties?.cluster && c.properties?.point_count > 2
        )
        
        // Get individual points from clusters with 2 or fewer points
        const smallClusterPoints: any[] = []
        clusters.forEach((cluster: any) => {
          if (cluster.properties?.cluster && cluster.properties?.point_count <= 2) {
            // Expand small clusters into individual points
            const leaves = this.state.index.getLeaves(cluster.properties.cluster_id, Infinity)
            smallClusterPoints.push(...leaves)
          } else if (!cluster.properties?.cluster) {
            // Already an individual point
            smallClusterPoints.push(cluster)
          }
        })
        
        // Check if we have actual clusters (point_count > 2)
        const hasActualClusters = actualClusters.length > 0
        
        // Store cluster data with road bounding boxes for rendering
        const clusterData = actualClusters.map((cluster: any) => {
          const pointCount = cluster.properties?.point_count || 1
          const leaves = this.state.index.getLeaves(cluster.properties.cluster_id, Infinity)
          
          // Collect all road geometry coordinates
          const allCoords: number[][] = []
          leaves.forEach((leaf: any) => {
            const alert = leaf.properties?.alert
            // Get road geometry if available
            if (alert?.geometry?.coordinates && alert.geometry.type === "LineString") {
              allCoords.push(...alert.geometry.coordinates)
            }
            // Also include point position
            if (leaf.geometry?.coordinates) {
              allCoords.push(leaf.geometry.coordinates)
            }
          })
          
          // Calculate road bounding box
          let roadBbox: [number, number, number, number] | null = null
          let clusterCenter: [number, number] = cluster.geometry.coordinates
          
          if (allCoords.length > 0) {
            const lngs = allCoords.map(c => c[0])
            const lats = allCoords.map(c => c[1])
            roadBbox = [
              Math.min(...lngs), // west
              Math.min(...lats), // south
              Math.max(...lngs), // east
              Math.max(...lats), // north
            ]
            // Center the cluster on the road extent
            clusterCenter = [
              (roadBbox[0] + roadBbox[2]) / 2,
              (roadBbox[1] + roadBbox[3]) / 2,
            ]
          }
          
          return {
            ...cluster,
            geometry: {
              ...cluster.geometry,
              coordinates: clusterCenter,
            },
            isCluster: true,
            pointCount,
            roadBbox,
          }
        })

        this.setState({
          data: clusterData,
          individualPoints: smallClusterPoints,
          z,
          hasClusters: hasActualClusters,
          lastBbox: bbox,
        })

        // Notify parent about clustering state
        if (props.onClusteringChange) {
          props.onClusteringChange(hasActualClusters)
        }
      }
    }
  }

  getPickingInfo({ info, mode }: any) {
    const pickedObject = info.object
    if (pickedObject) {
      if (pickedObject.properties?.cluster && mode !== "hover") {
        // Get all alerts in the cluster
        const leaves = this.state.index
          .getLeaves(pickedObject.properties.cluster_id, Infinity)
          .map((f: any) => f.properties.alert)
        info.objects = leaves
      }
      info.object = pickedObject.properties || pickedObject
    }
    return info
  }

  renderLayers() {
    // No deck.gl layers - clustering state is managed here,
    // but visual display is handled by HTML overlay (ClusterCountOverlay)
    return []
  }
}

