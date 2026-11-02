namespace eval ::hexrefine_native {
    proc decode {hex} { return [encoding convertfrom utf-8 [binary format H* $hex]] }
    proc snapshot {} {
        variable snapshotFile
        variable python
        *createmark nodes 1 all
        *createmark elems 1 all
        set nodeCount [hm_marklength nodes 1]
        set elementCount [hm_marklength elems 1]
        if {$nodeCount != @NODES@ || $elementCount != @ELEMENTS@} { error "Snapshot entity counts changed" }
        set stream [open $snapshotFile w]
        fconfigure $stream -encoding utf-8 -translation lf
        foreach {entity count attributes} [list nodes $nodeCount {id x y z} elems $elementCount {id config collector.id nodes}] {
            puts $stream [list $entity $count]
            *createmark $entity 1 all
            foreach attribute $attributes {
                set values [hm_getvalue $entity mark=1 dataname=$attribute]
                if {$attribute eq "config"} {
                    foreach config $values {
                        if {$config != 208} { error "Only nondegenerate H8 config 208 is supported" }
                    }
                }
                if {$attribute eq "collector.id"} {
                    foreach pid $values {
                        if {[lsearch -integer -exact {@SOURCEPIDS@} $pid] < 0} { error "Native import changed source part IDs" }
                    }
                }
                puts $stream $values
            }
        }
        close $stream
        set digest [exec $python -B -c {import hashlib,sys;h=hashlib.sha256();f=open(sys.argv[1],'rb');[h.update(b) for b in iter(lambda:f.read(1048576),b'')];print(h.hexdigest())} $snapshotFile]
        file delete $snapshotFile
        return [list $nodeCount $elementCount [string trim $digest]]
    }
    proc associated {boundary} {
        set count 0
        foreach id $boundary {
            if {[lindex [hm_getnodegeometry $id initial] 0] ne "none"} { incr count }
        }
        return $count
    }
    proc same_snapshot {expected actual log label} {
        if {$expected eq $actual} { return }
        puts $log "difference expected=$expected actual=$actual"
        flush $log
        error "$label changed mesh IDs, coordinates, connectivity or collectors"
    }
    proc same_bounds {expected actual} {
        if {[llength $expected] != 6 || [llength $actual] != 6} { error "Invalid CAD bounds" }
        foreach old $expected new $actual {
            if {abs($old-$new) > 0.00001} { error "HM reopen changed CAD bounds beyond 1e-5 mm" }
        }
    }
    proc run {} {
        variable python
        variable snapshotFile
        set python [decode {@PYTHON@}]
        set mesh [decode {@MESH@}]
        set cad [decode {@CAD@}]
        set database [decode {@DATABASE@}]
        set audit [decode {@AUDIT@}]
        set snapshotFile [file join [file dirname $audit] native-snapshot.txt]
        set template [decode {@TEMPLATE@}]
        set roundtrip [decode {@ROUNDTRIP@}]
        set boundary {@BOUNDARY@}
        set log [open $audit w]
        if {[catch {
            if {$cad ne ""} {
                *createstringarray 1 {CADIO_SPLIT_COMPONENTS_BY_BODY}
                *feinputwithdata2 {#ct\step_reader} $cad 0 0 0 0 0 1 1 1 0
                if {[llength [hm_entitylist solids id]] != @SOLIDS@} { error "Unexpected imported CAD solid count" }
                *createmark components 1 all
                *renumber components 1 @GEOCOMPSTART@ 1 0 0
                puts $log "phase geometry-imported-before-mesh"
                flush $log
            }
            *createstringarray 2 {LsDyna } {Keyword971 }
            *feinputwithdata2 {#ls-dyna\dynakey} $mesh 0 0 0 0 0 1 2 1 0
            *createmark nodes 1 all
            *createmark elems 1 all
            set node_count [hm_marklength nodes 1]
            set element_count [hm_marklength elems 1]
            if {$node_count != @NODES@ || $element_count != @ELEMENTS@} { error "Unexpected imported mesh counts" }
            set original [snapshot]
            puts $log "nodes $node_count"
            puts $log "elements $element_count"
            puts $log "boundaryNodes @BOUNDARYCOUNT@"
            flush $log
            if {$cad ne "" && @ASSOCIATE@} {
                *createmark nodes 1 {*}$boundary
                *associate_nodes_to_geom mesh_entity_mark=1 mesh_entity=nodes manual_association=0 assoc_tol=@TOLERANCE@ snap_nodes=0 override_assoc=0
                same_snapshot $original [snapshot] $log "Geometry association"
            }
            puts $log "phase association-snapshot-verified"
            flush $log
            set surfaces [llength [hm_entitylist surfs id]]
            set solids [llength [hm_entitylist solids id]]
            set associations 0
            if {$cad ne ""} {
                set associations -1
                if {@ASSOCIATE@} { set associations [associated $boundary] }
            }
            if {$cad eq "" && ($surfaces != 0 || $solids != 0)} { error "Mesh-only export unexpectedly contains CAD" }
            if {$cad ne "" && $surfaces == 0} { error "CAD export has no geometric surfaces" }
            if {$cad ne "" && @ASSOCIATE@ && $associations == 0} { error "No mesh nodes were associated with CAD" }
            if {$cad ne ""} {
                *createmark solids 1 all
                set cadBounds [hm_getboundingbox solids 1]
                puts $log "cadBounds $cadBounds"
            }
            puts $log "surfaces $surfaces"
            puts $log "solids $solids"
            puts $log "associatedNodes $associations"
            flush $log
            *writefile $database 0
            puts $log "phase native-saved"
            flush $log
            hm_answernext yes
            *deletemodel
            *readfile $database
            same_snapshot $original [snapshot] $log "HM reopen"
            if {[llength [hm_entitylist surfs id]] != $surfaces || [llength [hm_entitylist solids id]] != $solids} { error "HM reopen changed CAD entity counts" }
            if {$cad ne ""} {
                *createmark solids 1 all
                set reopenedBounds [hm_getboundingbox solids 1]
                puts $log "reopenedCadBounds $reopenedBounds"
                same_bounds $cadBounds $reopenedBounds
            }
            if {@ASSOCIATE@ && [associated $boundary] != $associations} { error "HM reopen changed geometry association count" }
            if {@NATIVEKEXPORT@} {
                *feoutputmergeincludefiles 0
                *feoutputwithdata $template $roundtrip 0 0 1 1 0
            }
            *createmark nodes 1 all
            *createmark elems 1 all
            puts $log "reopenedNodes [hm_marklength nodes 1]"
            puts $log "reopenedElements [hm_marklength elems 1]"
            puts $log "meshUnchanged 1"
            puts $log "status complete"
        } message]} {
            puts $log "status failed"
            puts $log "error $message"
            puts $log $::errorInfo
            close $log
            error $message
        }
        close $log
    }
}
::hexrefine_native::run
