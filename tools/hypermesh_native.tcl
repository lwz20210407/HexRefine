namespace eval ::hexrefine_native {
    proc decode {hex} { return [encoding convertfrom utf-8 [binary format H* $hex]] }
    proc snapshot {} {
        set nodes [lsort -integer [hm_entitylist nodes id]]
        set elements [lsort -integer [hm_entitylist elems id]]
        set records [list $nodes $elements]
        foreach attribute {x y z} {
            lappend records [hm_getvalue nodes user_ids=$nodes dataname=$attribute]
        }
        set configs [hm_getvalue elems user_ids=$elements dataname=config]
        foreach config $configs {
            if {$config != 208} { error "Only nondegenerate H8 config 208 is supported" }
        }
        lappend records $configs [hm_getvalue elems user_ids=$elements dataname=collector.id] [hm_getvalue elems user_ids=$elements dataname=nodes]
        return $records
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
        set fields {nodeIDs elementIDs x y z configs collectors connectivity}
        for {set i 0} {$i < [llength $fields]} {incr i} {
            set old [lindex $expected $i]
            set new [lindex $actual $i]
            if {$old ne $new} {
                puts $log "difference [lindex $fields $i] lengths [llength $old] [llength $new]"
                set examples 0
                for {set j 0} {$j < [llength $old] && $examples < 3} {incr j} {
                    if {[lindex $old $j] ne [lindex $new $j]} {
                        puts $log "difference-index $j before=[lindex $old $j] after=[lindex $new $j]"
                        incr examples
                    }
                }
            }
        }
        flush $log
        error "$label changed mesh IDs, coordinates, connectivity or collectors"
    }
    proc run {} {
        set mesh [decode {@MESH@}]
        set cad [decode {@CAD@}]
        set database [decode {@DATABASE@}]
        set audit [decode {@AUDIT@}]
        set template [decode {@TEMPLATE@}]
        set roundtrip [decode {@ROUNDTRIP@}]
        set boundary {@BOUNDARY@}
        set log [open $audit w]
        if {[catch {
            *createstringarray 2 {LsDyna } {Keyword971 }
            *feinputwithdata2 {#ls-dyna\dynakey} $mesh 0 0 0 0 0 1 2 1 0
            set node_count [llength [hm_entitylist nodes id]]
            set element_count [llength [hm_entitylist elems id]]
            if {$node_count != @NODES@ || $element_count != @ELEMENTS@} { error "Unexpected imported mesh counts" }
            set original [snapshot]
            puts $log "nodes $node_count"
            puts $log "elements $element_count"
            puts $log "boundaryNodes [llength $boundary]"
            flush $log
            if {$cad ne ""} {
                *createstringarray 1 {CADIO_SPLIT_COMPONENTS_BY_BODY}
                *feinputwithdata2 {#ct\step_reader} $cad 0 0 0 0 0 1 1 1 0
                puts $log "phase geometry-imported"
                flush $log
                if {[llength [hm_entitylist solids id]] != @SOLIDS@} { error "Unexpected imported CAD solid count" }
                same_snapshot $original [snapshot] $log "Geometry import"
                if {@ASSOCIATE@} {
                    *createmark nodes 1 {*}$boundary
                    *associate_nodes_to_geom mesh_entity_mark=1 mesh_entity=nodes manual_association=0 assoc_tol=@TOLERANCE@ snap_nodes=0 override_assoc=0
                }
            }
            same_snapshot $original [snapshot] $log "Geometry association"
            set surfaces [llength [hm_entitylist surfs id]]
            set solids [llength [hm_entitylist solids id]]
            set associations [associated $boundary]
            if {$cad eq "" && ($surfaces != 0 || $solids != 0)} { error "Mesh-only export unexpectedly contains CAD" }
            if {$cad ne "" && $surfaces == 0} { error "CAD export has no geometric surfaces" }
            if {$cad ne "" && @ASSOCIATE@ && $associations == 0} { error "No mesh nodes were associated with CAD" }
            puts $log "surfaces $surfaces"
            puts $log "solids $solids"
            puts $log "associatedNodes $associations"
            flush $log
            *writefile $database 0
            hm_answernext yes
            *deletemodel
            *readfile $database
            same_snapshot $original [snapshot] $log "HM reopen"
            if {[llength [hm_entitylist surfs id]] != $surfaces || [llength [hm_entitylist solids id]] != $solids} { error "HM reopen changed CAD entity counts" }
            if {[associated $boundary] != $associations} { error "HM reopen changed geometry association count" }
            *feoutputmergeincludefiles 0
            *feoutputwithdata $template $roundtrip 0 0 1 1 0
            puts $log "reopenedNodes [llength [hm_entitylist nodes id]]"
            puts $log "reopenedElements [llength [hm_entitylist elems id]]"
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
