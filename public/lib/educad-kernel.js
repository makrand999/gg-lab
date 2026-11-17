(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory({
      Surfaces:require('./educad-surfaces.js'),
      Implicit:require('./educad-implicit.js'),
      Predicates:require('./educad-predicates.js'),
      Planar:require('./educad-planar.js'),
      Correspondence:require('./educad-correspondence.js'),
      Constraints:require('./educad-constraints.js'),
      Ref3d:require('./educad-ref3d.js')
    });
  } else {
    root.EduCADKernel = factory({
      Surfaces:root.EduCADSurfaces,
      Implicit:root.EduCADImplicit,
      Predicates:root.EduCADPredicates,
      Planar:root.EduCADPlanar,
      Correspondence:root.EduCADCorrespondence,
      Constraints:root.EduCADConstraints,
      Ref3d:root.EduCADRef3d
    });
  }
})(typeof window !== 'undefined' ? window : globalThis, function (modules) {
  'use strict';
  return {
    apiVersion:'1.0.0',
    version:'0.1.0',
    contracts:{
      surface:'analytic-surface-v1',
      certificate:'analytic-surface-certificate-v1',
      topology:'analytic-topology-v1',
      bounded:'bounded-intersection-v1',
      planar:'educad-planar-v1',
      planarBoolean:'planar-boolean-v1',
      silhouette:'analytic-silhouette-v1',
      silhouetteHlr:'silhouette-hlr-v1',
      torusSection:'torus-section-v1',
      torusQuadric:'torus-quadric-v1',
      implicitSurface:'implicit-surface-v1',
      implicitIntersection:'implicit-intersection-v1',
      featureGraph:'feature-graph-v1',
      correspondence:'correspondence-audit-v1',
      constraint:'constraint-report-v1',
      viewState:'view-state-v1',
      preview:'1.0.0-educad'
    },
    capabilities:{
      surfaces:['plane','cylinder','cone','sphere','torus'],
      operations:['section','intersect','intersectBounded','split','trim',
        'attachBoundary','classifyPoint','topology','featureGraph',
        'silhouettes','silhouetteHLR','planarBoolean','subtractContainedLoop'],
      predicates:['orient2d','orient3d','coplanar','pointOnPlane'],
      planarBooleans:['union','intersect','difference','xor'],
      exactness:['exact-decimal-rational','numeric']
    },
    Surfaces:modules.Surfaces,
    Implicit:modules.Implicit,
    Predicates:modules.Predicates,
    Planar:modules.Planar,
    Correspondence:modules.Correspondence,
    Constraints:modules.Constraints,
    Ref3d:modules.Ref3d
  };
});
