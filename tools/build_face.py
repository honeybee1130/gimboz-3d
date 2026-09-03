import bpy, sys, math, bmesh
from mathutils import Vector, kdtree
SRC=sys.argv[-2]; DST=sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
if 'Icosphere' in bpy.data.objects: bpy.data.objects.remove(bpy.data.objects['Icosphere'])
arm=bpy.data.objects['Armature']
body=bpy.data.objects['Body_Mosshopper']; mouth=bpy.data.objects['Mouth_GEO']; eyes=bpy.data.objects['PossessedGreen_Eyes']
LINE_Z=0.645; XLIM=0.165
def clamp(x,a=0,b=1): return max(a,min(b,x))
def sstep(e0,e1,x):
    t=clamp((x-e0)/(e1-e0)); return t*t*(3-2*t)

# ---------- 1. cut a seam along the mouth line in the body ----------
bm=bmesh.new(); bm.from_mesh(body.data)
mw=body.matrix_world; inv=mw.inverted()
region=[f for f in bm.faces if all((abs((mw@v.co).x)<XLIM and (mw@v.co).y<-0.08 and 0.58<(mw@v.co).z<0.71) for v in f.verts)]
geom=list(set([v for f in region for v in f.verts]+[e for f in region for e in f.edges]+region))
pno=(inv.to_3x3().transposed()@Vector((0,0,1))).normalized(); pco=inv@Vector((0,0,LINE_Z))
res=bmesh.ops.bisect_plane(bm,geom=geom,dist=1e-5,plane_co=pco,plane_no=pno,use_snap_center=False,clear_outer=False,clear_inner=False)
cut_edges=[g for g in res['geom_cut'] if isinstance(g,bmesh.types.BMEdge)]
# keep the seam short of the corners so the halves stay attached there
cut_edges=[e for e in cut_edges if all(abs((mw@v.co).x)<XLIM-0.012 for v in e.verts)]
bmesh.ops.split_edges(bm,edges=cut_edges)
bm.to_mesh(body.data); bm.free(); body.data.update()
print('seam edges',len(cut_edges),'body verts now',len(body.data.vertices))

# ---------- 2. mouth islands ----------
bm=bmesh.new(); bm.from_mesh(mouth.data); bm.verts.ensure_lookup_table()
isl=[-1]*len(bm.verts); comps=[]
for v in bm.verts:
    if isl[v.index]>=0: continue
    idx=len(comps); st=[v]; c=[]
    while st:
        q=st.pop()
        if isl[q.index]>=0: continue
        isl[q.index]=idx; c.append(q.index)
        for e in q.link_edges:
            o=e.other_vert(q)
            if isl[o.index]<0: st.append(o)
    comps.append(c)
bm.free()
comps.sort(key=lambda c:-len(c)); upper,lower,inner=comps[0],comps[1],comps[2]
UP,LO,IN=isl[upper[0]],isl[lower[0]],isl[inner[0]]

W={o.name:[o.matrix_world@v.co for v in o.data.vertices] for o in (body,mouth,eyes)}
# body: which side of the seam a vert sits on (by linked-face centroid)
bm=bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
side=[0]*len(bm.verts)
for v in bm.verts:
    if v.link_faces:
        cz=sum(((mw@f.calc_center_median()).z) for f in v.link_faces)/len(v.link_faces)
        side[v.index]=-1 if cz<LINE_Z else 1
bm.free()
kd_m=kdtree.KDTree(len(W['Mouth_GEO']))
for n,p in enumerate(W['Mouth_GEO']): kd_m.insert(p,n)
kd_m.balance()

def wx(x): return 1-sstep(0.12,0.21,abs(x))
def wj(x): return 1-sstep(0.06,XLIM-0.012,abs(x))   # jaw opening tapers to zero exactly where the seam ends
def wz_low(z): return sstep(0.44,0.60,z)          # 1 at the lip, fades out down the belly
jaw_w={}; prox_w={}
for oname,pts in W.items():
    jw=[0.0]*len(pts); pw=[0.0]*len(pts)
    for i,p in enumerate(pts):
        if oname=='Mouth_GEO':
            k=isl[i]
            if k==LO: jw[i]=wj(p.x)*max(0.25,wz_low(p.z))
            elif k==IN: jw[i]=wj(p.x)*(1-sstep(0.60,0.645,p.z))
            pw[i]=wx(p.x)
        elif oname=='Body_Mosshopper':
            if p.y>0.05 or abs(p.x)>0.24 or p.z<0.40 or p.z>0.80: continue
            if side[i]<0 and p.z<=LINE_Z+0.002:
                jw[i]=wj(p.x)*wz_low(p.z)*(1-sstep(-0.02,0.05,p.y))
            pw[i]=(1-sstep(0.015,0.05,kd_m.find(p)[2]))*wx(p.x)
    jaw_w[oname]=jw; prox_w[oname]=pw
print('body jaw verts',sum(1 for w in jaw_w['Body_Mosshopper'] if w>0.01))

# ---------- 3. deformers ----------
PIV=Vector((0,0.08,LINE_Z))
EYE_C={'L':Vector((0.097,-0.04,0.745)),'R':Vector((-0.097,-0.04,0.745))}
def deform(oname,i,p,jaw=0,corner=1.0,lipz=0,pucker=0,blink=0,squint=0,side='LR'):
    q=p.copy()
    if oname in ('Mouth_GEO','Body_Mosshopper'):
        jw=jaw_w[oname][i]; pw=prox_w[oname][i]
        if jaw and jw>0:
            th=math.radians(jaw)*jw; d=q-PIV
            y=d.y*math.cos(th)-d.z*math.sin(th); z=d.y*math.sin(th)+d.z*math.cos(th)
            q=PIV+Vector((d.x,y,z))
        if pw>0:
            if corner!=1.0: q.x+=clamp(q.x*(corner-1)*pw,-0.012,0.012)
            if lipz: q.z+=lipz*clamp(abs(p.x)/0.15)**1.5*pw
            if pucker: q.y-=pucker*pw
    elif oname=='PossessedGreen_Eyes':
        s='L' if p.x>0 else 'R'
        if s in side:
            c=EYE_C[s]
            if blink: q.z=c.z+(q.z-c.z)*(1-0.92*blink); q.y+=0.012*blink
            if squint: q.z=c.z+(q.z-c.z)*(1-squint)
    return q
KEYS={
 'A':dict(jaw=13),
 'I':dict(jaw=2.5,corner=1.12),
 'U':dict(jaw=4,corner=0.75,pucker=0.015),
 'E':dict(jaw=6,corner=1.06),
 'O':dict(jaw=9,corner=0.80,pucker=0.008),
 'Blink':dict(blink=1),
 'Blink_L':dict(blink=1,side='L'),
 'Blink_R':dict(blink=1,side='R'),
 'Joy':dict(jaw=3,corner=1.08,lipz=0.02,squint=0.3),
 'Sorrow':dict(corner=0.95,lipz=-0.02),
 'Angry':dict(corner=1.05,lipz=-0.015,squint=0.55),
 'Fun':dict(jaw=5,corner=1.10,lipz=0.025,squint=0.5),
}
for o in (body,mouth,eyes):
    o.shape_key_add(name='Basis',from_mix=False); inv=o.matrix_world.inverted()
    for kname,kw in KEYS.items():
        sk=o.shape_key_add(name=kname,from_mix=False)
        for i,p in enumerate(W[o.name]):
            q=deform(o.name,i,p,**kw)
            if q!=p: sk.data[i].co=inv@q
# ---------- 4. eye bones ----------
for ob in bpy.data.objects: ob.select_set(False)
bpy.context.view_layer.objects.active=arm; arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb=arm.data.edit_bones; ainv=arm.matrix_world.inverted()
for name,c in (('eye_l',EYE_C['L']),('eye_r',EYE_C['R'])):
    b=eb.new(name); b.head=ainv@c; b.tail=ainv@(c+Vector((0,-0.05,0))); b.parent=eb['head']; b.use_connect=False
bpy.ops.object.mode_set(mode='OBJECT')
for vg in list(eyes.vertex_groups): eyes.vertex_groups.remove(vg)
gl=eyes.vertex_groups.new(name='eye_l'); gr=eyes.vertex_groups.new(name='eye_r')
gl.add([i for i,p in enumerate(W['PossessedGreen_Eyes']) if p.x>0],1.0,'REPLACE')
gr.add([i for i,p in enumerate(W['PossessedGreen_Eyes']) if p.x<=0],1.0,'REPLACE')
# sanity: every body vert still skinned
unw=sum(1 for v in body.data.vertices if not v.groups or sum(g.weight for g in v.groups)<0.5)
print('body verts with weak skin weights',unw)
bpy.ops.export_scene.gltf(filepath=DST,export_format='GLB',export_morph=True,export_morph_normal=True,
    export_skins=True,export_animations=False,export_apply=False,export_image_format='AUTO',use_selection=False)
print('EXPORTED',DST)
