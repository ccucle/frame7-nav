-- avatar-unlocks/v1 1.0.0
local M = { api = 1, version = "1.0.0", catalog = {} }

local function key(value)
    return type(value) == "string" and #value <= 48 and value:match("^[a-z0-9][a-z0-9_-]*$") ~= nil
end

local function exists(path)
    local f = io.open(path,"rb")
    if f then f:close(); return true end
    return false
end

function M.connect(dataPath, avatar, profile, catalog)
    assert(key(avatar) and key(profile), "invalid avatar or profile")
    local prefix = dataPath .. "unlock~" .. avatar .. "~" .. profile .. "~"
    local pending = prefix .. tostring({}):gsub("[^a-zA-Z0-9]", "") .. "-" .. os.time() .. ".tmp"
    local index, ordered = {}, {}
    local function register(item)
        assert(key(item.id) and key(item.kind) and type(item.level)=="number" and item.level >= 1
            and item.level==math.floor(item.level) and not index[item.id], "invalid reward catalog")
        index[item.id]=item
        ordered[#ordered+1]=item
    end
    for _,item in ipairs(M.catalog) do register(item) end
    for _,item in ipairs(catalog) do register(item) end
    table.sort(ordered,function(a,b) if a.level==b.level then return a.id<b.id end return a.level<b.level end)
    local session = {}
    function session:owns(id)
        return index[id] ~= nil and exists(prefix .. id .. ".owned")
    end
    function session:sync(level)
        assert(type(level)=="number" and level>=1 and level==math.floor(level),"invalid level")
        local added = {}
        for _,item in ipairs(ordered) do
            if item.level>level then break end
            local path = prefix .. item.id .. ".owned"
            if not exists(path) then
                local file = assert(io.open(pending,"wb"))
                local written = file:write(item.id,"\n")
                local closed = file:close()
                assert(written and closed,"reward save failed")
                -- On Windows rename creates the receipt only if no other instance won.
                if os.rename(pending,path) then added[#added+1]=item.id
                else os.remove(pending); assert(exists(path),"reward commit failed") end
            end
        end
        return added
    end
    function session:selected(kind)
        assert(key(kind),"invalid reward kind")
        local file=io.open(prefix..kind..".selection","rb")
        if not file then return nil end
        local last
        for line in file:lines() do
            local id=line:match("^=([a-z0-9_-]*)!$")
            if id then last=id end
        end
        file:close()
        if index[last] and index[last].kind==kind and self:owns(last) then return last end
    end
    function session:select(kind,id)
        assert(key(kind) and (id==nil or (index[id] and index[id].kind==kind and self:owns(id))),"reward unavailable")
        if self:selected(kind)==id then return end
        local file=assert(io.open(prefix..kind..".selection","ab"))
        local written=file:write("\n="..(id or "").."!\n")
        local closed=file:close()
        assert(written and closed,"selection save failed")
    end
    return session
end
return M
